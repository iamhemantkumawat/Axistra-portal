import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletCode, WalletLedger } from '../entities/wallet-ledger.entity';
import { buildConversionBatch } from './batch-builder';

@Injectable()
export class TreasuryService {
  constructor(
    @InjectRepository(TreasuryMovement) private repo: Repository<TreasuryMovement>,
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(TreasuryBatch) private batchRepo: Repository<TreasuryBatch>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
    @InjectRepository(WalletLedger) private ledgerRepo: Repository<WalletLedger>,
    private audit: AuditService,
    private wallets: WalletsService,
  ) {}

  /** Map the recharge's `payment_gateway` string to a WalletCode. Falls back
   *  to BINANCE rather than the invalid 'MANUAL' so the ledger fan-out always
   *  targets a real wallet — corrupt ledger rows would be far worse than a
   *  best-guess default that an admin can fix afterwards. */
  private sourceWalletFor(recharge: Recharge): WalletCode {
    const g = (recharge.payment_gateway || '').toLowerCase();
    if (g.includes('oxapay')) return 'OXAPAY';
    if (g.includes('btcpay')) return 'BTCPAY';
    if (g.includes('binance')) return 'BINANCE';
    if (g.includes('okx')) return 'OKX';
    return 'BINANCE';
  }

  private async nextBatchCode(sourceGateway?: string) {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prefix = this.batchPrefix(sourceGateway);
    const count = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.batch_code LIKE :prefix', { prefix: `${prefix}-${stamp}-%` })
      .getCount();
    return `${prefix}-${stamp}-${String(count + 1).padStart(5, '0')}`;
  }

  private batchPrefix(sourceGateway?: string) {
    const source = String(sourceGateway || '').toLowerCase();
    if (source.includes('btcpay')) return 'BPAY';
    if (source.includes('oxapay')) return 'OPAY';
    if (source.includes('binance')) return 'BIN';
    if (source.includes('okx')) return 'OKX';
    if (source.includes('vendor')) return 'VPAY';
    if (source.includes('bank')) return 'BANK';
    return 'TB';
  }

  async list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async reconciliation() {
    const all = await this.rechargeRepo.find({ relations: ['customer'], order: { created_at: 'DESC' } });
    const movements = await this.repo.find();
    const crypto = await this.cryptoRepo.find({ order: { created_at: 'ASC' } });
    const movementByRecharge = new Map(movements.map((m) => [m.recharge_id, m]));
    const cryptoByRecharge = new Map<string, CryptoTransaction[]>();
    for (const tx of crypto) {
      const rows = cryptoByRecharge.get(tx.recharge_id) || [];
      rows.push(tx);
      cryptoByRecharge.set(tx.recharge_id, rows);
    }
    const batches = await this.listBatches();
    const assignedRechargeIds = new Set(movements.filter((m) => m.treasury_batch_id).map((m) => m.recharge_id));
    const readyForSettlement = all.filter((r) => (
      !assignedRechargeIds.has(r.id)
      && !!r.tx_hash
      && !!r.magnus_credited_at
      && !r.reconciled
      && !['mismatch', 'refunded', 'failed'].includes(r.status)
    ));

    // Bank Deposited: read from the wallet_ledger (single source of truth)
    // instead of summing batch.fiat_received — that double-counted AED
    // sitting on exchanges as if it were already in Wio.
    const wioRow = await this.ledgerRepo
      .createQueryBuilder('l')
      .select('COALESCE(SUM(l.amount), 0)', 'total')
      .where("l.wallet = 'WIO_BANK'")
      .andWhere("l.coin = 'AED'")
      .andWhere("l.tx_type = 'bank_deposit'")
      .getRawOne();
    const totalBankDeposited = parseFloat(wioRow?.total || '0');

    // Drift = (sum of wallet_ledger AED balances on exchanges) vs (sum of
    // batches still pending Wio deposit, in their AED equivalent).  A
    // positive drift means there's AED parked on exchanges that nobody has
    // staged as a pending batch yet — operator action required.
    const drift = await this.computeDrift();

    const totals = {
      total_recharges: all.length,
      pending: all.filter((r) => !r.reconciled && r.status !== 'mismatch' && r.status !== 'refunded').length,
      mismatch: all.filter((r) => r.status === 'mismatch').length,
      reconciled: all.filter((r) => r.reconciled).length,
      ready_for_settlement: readyForSettlement.length,
      open_batches: batches.filter((b: any) => b.status !== 'reconciled').length,
      total_batch_invoice_amount: batches.reduce((s: number, b: any) => s + parseFloat(b.total_invoice_amount || '0'), 0),
      total_bank_deposited: totalBankDeposited,
      drift_aed: drift.drift_aed,
      drift_components: drift.components,
    };
    return {
      totals,
      recharges: all.map((r) => ({
        ...r,
        treasury: movementByRecharge.get(r.id) || null,
        crypto_transactions: cryptoByRecharge.get(r.id) || [],
      })),
      batches: batches.slice(0, 25),
    };
  }

  /**
   * Computes the AED drift between exchanges and Wio.
   *   drift_aed  = AED currently held on Binance + OKX (any non-zero balance)
   *                + AED-equivalent of USDT/USD/BTC/ETH still on exchanges
   *                  (best-effort: USDT and USD counted 1:1 vs AED at 3.67,
   *                  others ignored to stay deterministic).
   * Returns the gross AED-equivalent amount of money that *should* eventually
   * settle to Wio but hasn't yet.
   */
  private async computeDrift(): Promise<{ drift_aed: number; components: any[] }> {
    const USD_TO_AED = 3.6725;
    const rows = await this.ledgerRepo
      .createQueryBuilder('l')
      .select('l.wallet', 'wallet').addSelect('l.coin', 'coin')
      .addSelect('COALESCE(SUM(l.amount), 0)::text', 'balance')
      .where("l.wallet IN ('BINANCE','OKX','AED_TREASURY')")
      .groupBy('l.wallet').addGroupBy('l.coin')
      .having('COALESCE(SUM(l.amount), 0) <> 0')
      .getRawMany();
    const components: any[] = [];
    let total = 0;
    for (const r of rows) {
      const bal = parseFloat(r.balance);
      if (Math.abs(bal) < 0.01) continue;
      let aedEq = 0;
      const coin = String(r.coin).toUpperCase();
      if (coin === 'AED') aedEq = bal;
      else if (coin === 'USDT' || coin === 'USD') aedEq = bal * USD_TO_AED;
      else continue; // BTC/ETH excluded — operator must convert first
      components.push({ wallet: r.wallet, coin, balance: bal, aed_equiv: aedEq });
      total += aedEq;
    }
    return { drift_aed: total, components };
  }

  async listBatches() {
    // Order by the actual EVENT date (conversion / exchange / bank deposit),
    // not the row's insert timestamp.  Backfilled or back-dated batches must
    // sort by when the trade actually happened on the exchange, otherwise a
    // freshly imported May-22 conversion would float above June activity.
    const batches = await this.batchRepo
      .createQueryBuilder('b')
      .orderBy(
        'COALESCE(b.bank_deposit_date, b.conversion_date, b.usdt_conversion_date, b.exchange_received_at, b.period_end, b.created_at)',
        'DESC',
      )
      .getMany();
    const rows = await Promise.all(batches.map(async (b) => {
      const movements = await this.repo.find({ where: { treasury_batch_id: b.id } });
      const recharges = movements.length
        ? await this.rechargeRepo.find({ where: { id: In(movements.map((m) => m.recharge_id)) } })
        : [];
      return {
        ...b,
        movements_count: movements.length,
        gateway_summary: this.uniqueLabel(recharges.map((r) => r.payment_gateway)),
        recharge_codes: recharges.map((r) => r.recharge_code),
      };
    }));
    return rows;
  }

  async getBatch(id: string) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    const movements = await this.repo.find({ where: { treasury_batch_id: id } });
    const recharges = movements.length
      ? await this.rechargeRepo.find({ where: { id: In(movements.map((m) => m.recharge_id)) }, relations: ['customer'] })
      : [];
    const crypto = movements.length
      ? await this.cryptoRepo.find({ where: { recharge_id: In(movements.map((m) => m.recharge_id)) }, order: { created_at: 'ASC' } })
      : [];
    const cryptoByRecharge = new Map<string, CryptoTransaction[]>();
    for (const tx of crypto) {
      const rows = cryptoByRecharge.get(tx.recharge_id) || [];
      rows.push(tx);
      cryptoByRecharge.set(tx.recharge_id, rows);
    }
    return { ...batch, movements, recharges: recharges.map((r) => ({ ...r, crypto_transactions: cryptoByRecharge.get(r.id) || [] })) };
  }

  async createBatch(data: Partial<TreasuryBatch>, actor?: any) {
    const batch = this.batchRepo.create({
      batch_code: data.batch_code || await this.nextBatchCode(data.source_gateway),
      name: data.name || `Treasury Batch ${new Date().toISOString().slice(0, 10)}`,
      period_start: data.period_start,
      period_end: data.period_end,
      source_wallet: data.source_wallet,
      source_gateway: data.source_gateway,
      destination_exchange: data.destination_exchange || 'OKX',
      destination_wallet: data.destination_wallet,
      settlement_tx_hash: data.settlement_tx_hash,
      settlement_reference: data.settlement_reference,
      coin: data.coin,
      network: data.network,
      transfer_fee_crypto: data.transfer_fee_crypto,
      received_crypto_amount: data.received_crypto_amount,
      exchange_received_at: data.exchange_received_at,
      status: data.status || 'open',
      notes: data.notes,
    });
    const saved = await this.batchRepo.save(batch);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_treasury_batch', entity_type: 'treasury_batch', entity_id: saved.id,
      details: saved.batch_code,
    });
    return saved;
  }

  async updateBatch(id: string, data: Partial<TreasuryBatch>, actor?: any) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    Object.assign(batch, data);
    this.assertBatchEvidence(batch);
    batch.status = this.resolveBatchStatus(batch);
    const saved = await this.batchRepo.save(batch);
    await this.applyBatchStatus(saved);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_treasury_batch', entity_type: 'treasury_batch', entity_id: saved.id,
      details: saved.batch_code,
    });
    return saved;
  }

  async deleteBatch(id: string, actor?: any) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    // Cascade-delete the wallet_ledger rows we fanned out for this batch.
    // Each step writes rows with external_ref = '${batch_code}-<STEP>' — we
    // delete them all so the Wallet Ledger balance stays in sync.
    const refSuffixes = ['SWEEP', 'CONV-USDT', 'CONV-AED', 'WIO'];
    let ledgerRowsRemoved = 0;
    for (const suffix of refSuffixes) {
      const ref = `${batch.batch_code}-${suffix}`;
      const rows = await this.wallets.findByExternalRef(ref);
      for (const row of rows) {
        await this.wallets.deleteLedgerRow(row.id, actor).catch(() => undefined);
        ledgerRowsRemoved += 1;
      }
    }
    // Unlink recharges → movements → batch
    const linkedMovements = await this.repo.find({ where: { treasury_batch_id: batch.id } });
    for (const m of linkedMovements) {
      m.treasury_batch_id = null as any;
      await this.repo.save(m);
    }
    await this.batchRepo.delete({ id: batch.id });
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_treasury_batch', entity_type: 'treasury_batch', entity_id: batch.id,
      details: `${batch.batch_code} unlinked ${linkedMovements.length} movement(s), removed ${ledgerRowsRemoved} ledger row(s)`,
    });
    return { deleted: true, unlinked_movements: linkedMovements.length, ledger_rows_removed: ledgerRowsRemoved };
  }

  async syncBatchLedger(id: string, actor?: any) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    await this.applyBatchLedger(batch);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'sync_batch_ledger', entity_type: 'treasury_batch', entity_id: batch.id,
      details: `Re-fanned ${batch.batch_code} to wallet_ledgers`,
    });
    return { synced: true, batch_code: batch.batch_code };
  }

  /**
   * Remove just ONE step's data from a batch (and its wallet_ledger rows).
   * Used by the "Treasury feed" delete buttons so the user can delete the
   * Conversion row without nuking the underlying Sweep + recharge links.
   *  step = 'sweep' | 'usdt' | 'aed' | 'wio'
   */
  async clearBatchStep(id: string, step: 'sweep' | 'usdt' | 'aed' | 'wio', actor?: any) {
    if (!['sweep', 'usdt', 'aed', 'wio'].includes(step)) {
      throw new BadRequestException(`Unknown batch step '${step}'. Must be sweep, usdt, aed, or wio.`);
    }
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    const suffixMap = { sweep: 'SWEEP', usdt: 'CONV-USDT', aed: 'CONV-AED', wio: 'WIO' } as const;
    const ref = `${batch.batch_code}-${suffixMap[step]}`;
    const rows = await this.wallets.findByExternalRef(ref);
    let removed = 0;
    for (const row of rows) {
      await this.wallets.deleteLedgerRow(row.id, actor).catch(() => undefined);
      removed += 1;
    }
    // Wipe the batch fields for that step so re-saving the batch doesn't
    // immediately re-create the rows from applyBatchLedger.
    if (step === 'usdt') {
      batch.usdt_amount = null as any;
      batch.usdt_conversion_rate = null as any;
      batch.usdt_conversion_date = null as any;
      batch.usdt_conversion_reference = null as any;
    } else if (step === 'aed') {
      batch.crypto_converted = null as any;
      batch.conversion_rate = null as any;
      batch.fiat_received = null as any;
      batch.conversion_date = null as any;
    } else if (step === 'wio') {
      batch.bank_reference = null as any;
      batch.bank_deposit_date = null as any;
      batch.bank_fee_aed = null as any;
      batch.net_bank_deposit_amount = null as any;
    } else if (step === 'sweep') {
      batch.settlement_tx_hash = null as any;
      batch.exchange_received_at = null as any;
      batch.received_crypto_amount = null as any;
    }
    batch.status = this.resolveBatchStatus(batch);
    await this.batchRepo.save(batch);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: `clear_batch_${step}`, entity_type: 'treasury_batch', entity_id: batch.id,
      details: `${batch.batch_code}: cleared ${step} step (${removed} ledger row(s) removed)`,
    });
    return { cleared: step, ledger_rows_removed: removed, batch_status: batch.status };
  }

  async assignBatch(batchId: string, rechargeIds: string[], actor?: any) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Treasury batch not found');
    if (!rechargeIds.length) throw new BadRequestException('At least one recharge is required');

    let totalInvoice = 0;
    let totalCrypto = 0;
    let invoiceCurrency = batch.invoice_currency;
    let coin = batch.coin;
    let network = batch.network;
    const gateways = new Set<string>();
    const sourceWallets = new Set<string>();

    for (const rechargeId of rechargeIds) {
      const recharge = await this.rechargeRepo.findOne({ where: { id: rechargeId } });
      if (!recharge) throw new NotFoundException(`Recharge not found: ${rechargeId}`);
      if (!recharge.tx_hash) throw new BadRequestException(`Recharge ${recharge.recharge_code} has no customer payment TXID`);
      if (!recharge.magnus_credited_at || recharge.status === 'mismatch') {
        throw new BadRequestException(`Recharge ${recharge.recharge_code} is not ready for treasury settlement`);
      }
      let movement = await this.repo.findOne({ where: { recharge_id: rechargeId } });
      if (!movement) movement = this.repo.create({ recharge_id: rechargeId, customer_id: recharge.customer_id });
      movement.treasury_batch_id = batch.id;
      await this.repo.save(movement);
      totalInvoice += parseFloat(recharge.amount || '0');
      totalCrypto += parseFloat(recharge.crypto_amount || '0');
      invoiceCurrency = invoiceCurrency || recharge.currency;
      coin = coin || recharge.crypto_coin;
      network = network || recharge.crypto_network;
      if (recharge.payment_gateway) gateways.add(recharge.payment_gateway);
      if (movement.receiving_wallet_tag) sourceWallets.add(movement.receiving_wallet_tag);
      else if (movement.receiving_wallet) sourceWallets.add(movement.receiving_wallet);
      else if (recharge.wallet_address) sourceWallets.add(recharge.wallet_address);
    }

    batch.total_invoice_amount = totalInvoice.toFixed(2);
    batch.total_crypto_amount = totalCrypto.toFixed(8);
    batch.invoice_currency = invoiceCurrency;
    batch.coin = coin;
    batch.network = network;
    batch.source_gateway = batch.source_gateway || this.uniqueLabel([...gateways]);
    batch.source_wallet = batch.source_wallet || this.uniqueLabel([...sourceWallets]);
    batch.status = this.resolveBatchStatus(batch);
    const saved = await this.batchRepo.save(batch);
    await this.applyBatchStatus(saved);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'assign_treasury_batch', entity_type: 'treasury_batch', entity_id: saved.id,
      details: `${saved.batch_code}: ${rechargeIds.length} recharge(s)`,
    });
    return { ...saved, assigned: rechargeIds.length };
  }

  async verifyBtcBatchTransfer(batchId: string, actor?: any) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Treasury transfer not found');
    if ((batch.coin || '').toUpperCase() !== 'BTC') throw new BadRequestException('BTC verification is only available for BTC transfers');
    if (!batch.settlement_tx_hash) throw new BadRequestException('Treasury transfer TXID is required before mempool verification');
    if (!batch.destination_wallet) throw new BadRequestException('Exchange deposit wallet is required to calculate exact received BTC');

    const result = await this.lookupBitcoinTx(batch.settlement_tx_hash, batch.destination_wallet);
    if (!result.received_btc) {
      throw new BadRequestException('Destination wallet was not found in this BTC transaction outputs');
    }

    batch.transfer_fee_crypto = result.fee_btc;
    batch.received_crypto_amount = result.received_btc;
    batch.exchange_received_at = result.confirmed ? new Date() : batch.exchange_received_at;
    batch.settlement_reference = [
      batch.settlement_reference,
      `mempool confirmations: ${result.confirmations}`,
    ].filter(Boolean).join(' | ');
    batch.notes = [
      batch.notes,
      `BTC transfer verified from mempool. Inputs: ${result.input_addresses.join(', ') || 'unknown'}`,
    ].filter(Boolean).join('\n');
    batch.status = this.resolveBatchStatus(batch);

    const saved = await this.batchRepo.save(batch);
    await this.applyBatchStatus(saved);
    await this.audit.log({
      actor_id: actor?.id,
      actor_email: actor?.email,
      action: 'verify_btc_treasury_transfer',
      entity_type: 'treasury_batch',
      entity_id: batchId,
      details: `${saved.batch_code}: received ${saved.received_crypto_amount} BTC, fee ${saved.transfer_fee_crypto || '0'} BTC`,
    });
    return {
      ...saved,
      mempool_verification: result,
    };
  }

  async verifyBtcpayRecharge(rechargeId: string, actor?: any) {
    const recharge = await this.rechargeRepo.findOne({ where: { id: rechargeId } });
    if (!recharge) throw new NotFoundException('Recharge not found');
    const txs = (await this.cryptoRepo.find({ where: { recharge_id: rechargeId }, order: { created_at: 'ASC' } }))
      .filter((tx) => (tx.coin || '').toUpperCase() === 'BTC' && tx.tx_hash);
    if (!txs.length) throw new BadRequestException('No BTC transaction found for this BTCPay recharge');

    const verified = [];
    for (const tx of txs) {
      const result = await this.lookupBitcoinTx(tx.tx_hash, tx.receiving_wallet);
      if (result.input_addresses.length) tx.sender_address = result.input_addresses.join(', ');
      tx.confirmations = String(result.confirmations);
      tx.gateway_tx_status = result.confirmed ? 'confirmed' : 'mempool';
      if (result.received_btc) tx.received_amount = result.received_btc;
      tx.raw_gateway_payload = this.mergeRawGatewayPayload(tx.raw_gateway_payload, {
        mempool_verification: {
          verified_at: new Date().toISOString(),
          confirmed: result.confirmed,
          confirmations: result.confirmations,
          input_addresses: result.input_addresses,
          output_to_receiving_wallet_btc: result.received_btc,
        },
      });
      verified.push(await this.cryptoRepo.save(tx));
    }

    const movement = await this.repo.findOne({ where: { recharge_id: rechargeId } });
    if (movement && verified[0]?.sender_address) {
      movement.source_transaction_details = JSON.stringify(verified.map((tx) => ({
        tx_hash: tx.tx_hash,
        coin: tx.coin,
        network: tx.network,
        received_amount: tx.received_amount || tx.crypto_amount,
        sender_address: tx.sender_address,
        receiving_wallet: tx.receiving_wallet,
        confirmations: tx.confirmations,
        status: tx.gateway_tx_status,
      })));
      await this.repo.save(movement);
    }

    await this.audit.log({
      actor_id: actor?.id,
      actor_email: actor?.email,
      action: 'verify_btcpay_mempool',
      entity_type: 'recharge',
      entity_id: rechargeId,
      details: `${recharge.recharge_code}: ${verified.length} BTC transaction(s) verified`,
    });
    return { recharge_id: rechargeId, transactions: verified };
  }

  async upsertMovement(rechargeId: string, data: Partial<TreasuryMovement>, actor?: any) {
    const recharge = await this.rechargeRepo.findOne({ where: { id: rechargeId } });
    if (!recharge) throw new NotFoundException('Recharge not found');
    let m = await this.repo.findOne({ where: { recharge_id: rechargeId } });
    if (!m) {
      m = this.repo.create({ recharge_id: rechargeId, customer_id: recharge.customer_id });
    }
    Object.assign(m, data);
    this.assertMovementEvidence(recharge, m);
    const saved = await this.repo.save(m);

    // Mirror the 3 boolean stages into the wallet ledger so balances stay in
    // sync with what Crypto Treasury displays. Idempotent — re-running upsert
    // overwrites the prior pair via external_ref tagging.
    await this.wallets.syncMovementStep({
      step: 'okx',
      enabled: !!saved.transferred_to_okx,
      recharge_id: rechargeId,
      invoice_id: recharge.invoice_id,
      source_wallet: this.sourceWalletFor(recharge),
      coin: 'USDT',
      amount: saved.total_usdt_received,
      tx_hash: saved.okx_deposit_tx_hash,
      counterparty: saved.okx_account_reference || 'OKX',
      event_at: saved.okx_transfer_date || undefined,
    }, actor);
    await this.wallets.syncMovementStep({
      step: 'aed',
      enabled: !!saved.converted_to_aed,
      recharge_id: rechargeId,
      invoice_id: recharge.invoice_id,
      coin: 'USDT',
      amount: saved.usdt_converted,
      rate: saved.okx_conversion_rate,
      aed_amount: saved.aed_received,
      event_at: saved.conversion_date || undefined,
    }, actor);
    await this.wallets.syncMovementStep({
      step: 'wio',
      enabled: !!saved.transferred_to_wio,
      recharge_id: rechargeId,
      invoice_id: recharge.invoice_id,
      aed_amount: saved.wio_aed_amount,
      bank_reference: saved.wio_bank_reference,
      event_at: saved.wio_deposit_date || undefined,
    }, actor);

    // Advance recharge status based on movement state
    if (saved.transferred_to_wio && saved.converted_to_aed && saved.transferred_to_okx) {
      recharge.status = 'fully_reconciled';
      recharge.reconciled = true;
    } else if (saved.transferred_to_wio) {
      recharge.status = 'deposited_to_wio';
    } else if (saved.converted_to_aed) {
      recharge.status = 'converted_to_aed';
    } else if (saved.transferred_to_okx) {
      recharge.status = 'sent_to_okx';
    }
    await this.rechargeRepo.save(recharge);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'treasury_movement', entity_type: 'recharge', entity_id: rechargeId,
      details: 'Treasury movement updated',
    });
    return saved;
  }

  private assertMovementEvidence(recharge: Recharge, movement: TreasuryMovement) {
    if (movement.transferred_to_okx) {
      if (!recharge.tx_hash) throw new BadRequestException('Payment TX hash is required before OKX transfer');
      if (!recharge.magnus_credited_at || recharge.status === 'mismatch') {
        throw new BadRequestException('Matching Magnus credit is required before OKX transfer');
      }
      if (!movement.okx_deposit_tx_hash) throw new BadRequestException('OKX deposit TX hash is required');
    }

    if (movement.converted_to_aed) {
      if (!movement.transferred_to_okx) throw new BadRequestException('OKX transfer must be recorded before conversion');
      if (!this.isPositiveNumber(movement.usdt_converted)) throw new BadRequestException('USDT converted amount is required');
      if (!this.isPositiveNumber(movement.okx_conversion_rate)) throw new BadRequestException('OKX conversion rate is required');
      if (!this.isPositiveNumber(movement.aed_received)) throw new BadRequestException('AED received amount is required');
    }

    if (movement.transferred_to_wio) {
      if (!movement.converted_to_aed) throw new BadRequestException('AED conversion must be recorded before Wio deposit');
      if (!movement.wio_bank_reference) throw new BadRequestException('Wio bank reference is required');
      if (!movement.wio_deposit_date) throw new BadRequestException('Wio deposit date is required');
      if (!this.isPositiveNumber(movement.wio_aed_amount)) throw new BadRequestException('Wio AED amount is required');
    }
  }

  private isPositiveNumber(value: any) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0;
  }

  private async lookupBitcoinTx(txid: string, receivingWallet?: string) {
    const base = (process.env.MEMPOOL_API_BASE || 'https://mempool.space/api').replace(/\/$/, '');
    const txRes = await fetch(`${base}/tx/${txid}`);
    if (!txRes.ok) throw new BadRequestException(`Mempool lookup failed for ${txid}: ${txRes.status}`);
    const tx: any = await txRes.json();
    const inputAddresses = [...new Set((tx.vin || [])
      .map((vin: any) => vin?.prevout?.scriptpubkey_address)
      .filter(Boolean))] as string[];
    const outputSats = receivingWallet
      ? (tx.vout || []).reduce((sum: number, out: any) => (
        out?.scriptpubkey_address === receivingWallet ? sum + Number(out.value || 0) : sum
      ), 0)
      : 0;
    const tipHeight = tx?.status?.confirmed ? await this.lookupBitcoinTipHeight(base) : 0;
    const confirmations = tx?.status?.confirmed && tx?.status?.block_height && tipHeight
      ? Math.max(tipHeight - Number(tx.status.block_height) + 1, 1)
      : 0;
    return {
      confirmed: Boolean(tx?.status?.confirmed),
      confirmations,
      input_addresses: inputAddresses,
      received_btc: outputSats > 0 ? (outputSats / 100000000).toFixed(8) : undefined,
      fee_btc: this.bitcoinFee(tx),
    };
  }

  private bitcoinFee(tx: any) {
    const directFee = Number(tx?.fee || 0);
    if (Number.isFinite(directFee) && directFee > 0) return (directFee / 100000000).toFixed(8);
    const inputSats = (tx?.vin || []).reduce((sum: number, vin: any) => sum + Number(vin?.prevout?.value || 0), 0);
    const outputSats = (tx?.vout || []).reduce((sum: number, out: any) => sum + Number(out?.value || 0), 0);
    const computed = inputSats - outputSats;
    return Number.isFinite(computed) && computed > 0 ? (computed / 100000000).toFixed(8) : undefined;
  }

  private async lookupBitcoinTipHeight(base: string) {
    try {
      const res = await fetch(`${base}/blocks/tip/height`);
      if (!res.ok) return 0;
      const text = await res.text();
      return Number(text) || 0;
    } catch {
      return 0;
    }
  }

  private mergeRawGatewayPayload(raw: string | undefined, patch: Record<string, any>) {
    let parsed: any = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
    }
    return JSON.stringify({ ...parsed, ...patch });
  }

  private uniqueLabel(values: Array<string | null | undefined>) {
    const clean = [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
    if (clean.length === 0) return undefined;
    if (clean.length === 1) return clean[0];
    return 'Mixed';
  }

  private isDirectExchangeSource(batch: TreasuryBatch) {
    return ['direct', 'okx', 'binance'].includes(String(batch.source_gateway || '').toLowerCase());
  }

  private assertBatchEvidence(batch: TreasuryBatch) {
    if (batch.settlement_tx_hash && !batch.destination_exchange) {
      throw new BadRequestException('Destination exchange is required when settlement TXID is recorded');
    }
    if (batch.exchange_received_at || batch.received_crypto_amount) {
      if (!batch.settlement_tx_hash && !this.isDirectExchangeSource(batch)) {
        throw new BadRequestException('Settlement TXID is required before exchange receipt');
      }
      if (!this.isPositiveNumber(batch.received_crypto_amount || batch.total_crypto_amount)) {
        throw new BadRequestException('Exchange received crypto amount is required');
      }
    }
    if (batch.usdt_amount || batch.usdt_conversion_rate || batch.usdt_conversion_date) {
      if (!batch.settlement_tx_hash && !this.isDirectExchangeSource(batch)) {
        throw new BadRequestException('Settlement TXID is required before USDT conversion');
      }
      if (!this.isPositiveNumber(batch.usdt_amount)) throw new BadRequestException('USDT amount is required');
      if ((batch.coin || '').toUpperCase() !== 'USDT' && !this.isPositiveNumber(batch.usdt_conversion_rate)) {
        throw new BadRequestException('USDT conversion rate is required for non-USDT batches');
      }
    }
    if (batch.crypto_converted || batch.conversion_rate || batch.fiat_received) {
      if (!this.isPositiveNumber(batch.usdt_amount || batch.crypto_converted)) {
        throw new BadRequestException('USDT amount is required before AED conversion');
      }
      if (!this.isPositiveNumber(batch.crypto_converted)) throw new BadRequestException('Converted crypto amount is required');
      if (!this.isPositiveNumber(batch.conversion_rate)) throw new BadRequestException('Conversion rate is required');
      if (!this.isPositiveNumber(batch.fiat_received)) throw new BadRequestException('Fiat received amount is required');
    }
    if (batch.bank_reference || batch.bank_deposit_date) {
      if (!this.isPositiveNumber(batch.fiat_received)) throw new BadRequestException('Fiat received amount is required before bank deposit');
      if (!batch.bank_reference) throw new BadRequestException('Bank reference is required');
      if (!batch.bank_deposit_date) throw new BadRequestException('Bank deposit date is required');
      if (!batch.net_bank_deposit_amount) {
        const gross = parseFloat(batch.fiat_received || '0');
        const fee = parseFloat(batch.bank_fee_aed || '0');
        batch.net_bank_deposit_amount = Math.max(0, gross - fee).toFixed(2);
      }
    }
  }

  private resolveBatchStatus(batch: TreasuryBatch) {
    if (batch.bank_reference && batch.bank_deposit_date) return 'reconciled';
    if (this.isPositiveNumber(batch.fiat_received)) return 'converted_to_aed';
    if (this.isPositiveNumber(batch.usdt_amount)) return 'converted_to_usdt';
    if (batch.exchange_received_at || this.isPositiveNumber(batch.received_crypto_amount)) return 'received_in_exchange';
    if (batch.settlement_tx_hash) return 'sent_to_exchange';
    return batch.status || 'open';
  }

  private async applyBatchStatus(batch: TreasuryBatch) {
    const movements = await this.repo.find({ where: { treasury_batch_id: batch.id } });
    for (const movement of movements) {
      const recharge = await this.rechargeRepo.findOne({ where: { id: movement.recharge_id } });
      if (!recharge) continue;
      if (batch.status === 'reconciled') {
        recharge.status = 'fully_reconciled';
        recharge.reconciled = true;
      } else if (batch.status === 'converted_to_aed') {
        recharge.status = 'converted_to_aed';
      } else if (['sent_to_exchange', 'received_in_exchange', 'converted_to_usdt'].includes(batch.status)) {
        recharge.status = 'sent_to_okx';
      }
      await this.rechargeRepo.save(recharge);
    }
    // Fan-out to wallet_ledgers so balances in Wallet Ledger / Treasury chips
    // reflect the batch's sweep + conversion + bank deposit. Idempotent per
    // step via external_ref = `${batch_code}-<STEP>`.
    await this.applyBatchLedger(batch);
  }

  /**
   * Single entry point for in-exchange coin conversions (BINANCE/OKX/AED Treasury).
   * Called from the Wallet Ledger Convert modal. Atomically:
   *   1. Creates an auto-named Treasury batch (BIN-YYMMDD-NNNNN etc.) representing
   *      this conversion. `source_gateway`, `source_wallet`, `destination_exchange`
   *      and `destination_wallet` all default to the exchange name itself (the
   *      conversion is in-wallet).
   *   2. Finds unbatched, on-chain receipts on that exchange with matching coin
   *      (whose `crypto_amount` sum is <= from_amount) and assigns them to the
   *      new batch via TreasuryMovement rows. They appear as Direct Receipts
   *      tied to this conversion for the audit chain.
   *   3. Fans out wallet_ledger rows via applyBatchLedger (Sweep step is skipped
   *      because source === exchange; Convert step writes the convert_from /
   *      convert_to pair).
   * Returns { batch, assigned_recharges_count, ledger_pair }.
   */
  /**
   * One-time (idempotent) admin tool: scans the wallet_ledgers table for
   * `convert_from + convert_to` pairs that have a shared `external_ref` but
   * no matching `treasury_batches` row (i.e. legacy / hand-imported
   * conversions written before `wallets.convert()` started mirroring a
   * batch).  For each such pair we create the missing batch and stamp
   * `linked_batch_id` on the two ledger rows so the conversion finally
   * surfaces on the Crypto Treasury & Reconciliation page.
   *
   * Safe to re-run: pairs that already have a matching `treasury_batches`
   * row are reported under `skipped`.
   *
   * NOTE: we DO NOT call `applyBatchLedger` on the freshly-created batches.
   * The wallet_ledger rows are already there — running the fan-out would
   * create duplicate `*-CONV-USDT` / `*-CONV-AED` rows.
   */
  async backfillOrphanConversions(opts: { dryRun?: boolean } = {}, actor?: any) {
    // 1) Find every external_ref that looks like a conversion (has both a
    //    convert_from and a convert_to row) and isn't tied to a batch.
    const rows = await this.ledgerRepo
      .createQueryBuilder('l')
      .select('l.external_ref', 'ref')
      .addSelect('MIN(l.wallet)', 'wallet')
      .addSelect("MIN(CASE WHEN l.tx_type = 'convert_from' THEN l.coin END)", 'from_coin')
      .addSelect("MIN(CASE WHEN l.tx_type = 'convert_to'   THEN l.coin END)", 'to_coin')
      .addSelect("ABS(SUM(CASE WHEN l.tx_type = 'convert_from' THEN l.amount END))::text", 'from_amount')
      .addSelect("SUM(CASE WHEN l.tx_type = 'convert_to' THEN l.amount END)::text", 'to_amount')
      .addSelect('MIN(l.event_at)', 'event_at')
      .addSelect("MIN(l.notes)", 'notes')
      .addSelect("MIN(l.linked_batch_id)", 'linked_batch_id')
      .where('l.external_ref IS NOT NULL')
      .andWhere("l.tx_type IN ('convert_from','convert_to')")
      .groupBy('l.external_ref')
      .having("COUNT(DISTINCT l.tx_type) = 2")
      .getRawMany();

    const created: any[] = [];
    const skipped: any[] = [];
    const errored: any[] = [];

    for (const r of rows) {
      try {
        const batchCode: string = r.ref;
        // (a) If this external_ref is actually a STEP of an existing batch
        //     (the legacy `applyBatchLedger` writes refs like
        //     `<batch_code>-CONV-USDT` / `-CONV-AED` / `-SWEEP` / `-WIO`),
        //     don't create a duplicate — just link the ledger rows to the
        //     parent batch.
        const STEP_SUFFIXES = ['-CONV-USDT', '-CONV-AED', '-SWEEP', '-WIO'];
        const matchedSuffix = STEP_SUFFIXES.find((s) => batchCode.endsWith(s));
        if (matchedSuffix) {
          const parentCode = batchCode.slice(0, -matchedSuffix.length);
          const parent = await this.batchRepo.findOne({ where: { batch_code: parentCode } });
          if (parent) {
            if (!opts.dryRun) {
              await this.ledgerRepo.createQueryBuilder().update()
                .set({ linked_batch_id: parent.id })
                .where('external_ref = :ref', { ref: batchCode }).execute();
            }
            skipped.push({ ref: batchCode, reason: `step_of_existing_batch:${parentCode}` });
            continue;
          }
        }

        // (b) Skip if the batch already exists (idempotent re-run).
        const existingBatch = await this.batchRepo.findOne({ where: { batch_code: batchCode } });
        if (existingBatch) {
          // Ensure ledger rows are stamped — older runs might not have.
          if (!r.linked_batch_id) {
            if (!opts.dryRun) {
              await this.ledgerRepo.createQueryBuilder().update()
                .set({ linked_batch_id: existingBatch.id })
                .where('external_ref = :ref', { ref: batchCode }).execute();
            }
            skipped.push({ ref: batchCode, reason: 'batch_existed_relinked' });
          } else {
            skipped.push({ ref: batchCode, reason: 'batch_already_exists' });
          }
          continue;
        }

        const wallet = String(r.wallet || '').toUpperCase();
        if (!['BINANCE', 'OKX', 'AED_TREASURY'].includes(wallet)) {
          skipped.push({ ref: batchCode, reason: `wallet_not_treasury_tracked:${wallet}` });
          continue;
        }
        const fromAmt = parseFloat(r.from_amount || '0');
        const toAmt = parseFloat(r.to_amount || '0');
        if (!(fromAmt > 0) || !(toAmt > 0) || !r.from_coin || !r.to_coin) {
          skipped.push({ ref: batchCode, reason: 'incomplete_pair' });
          continue;
        }

        const partial = buildConversionBatch({
          wallet,
          from_coin: r.from_coin,
          to_coin: r.to_coin,
          from_amount: fromAmt,
          to_amount: toAmt,
          batch_code: batchCode,
          event_at: r.event_at ? new Date(r.event_at) : new Date(),
          notes: r.notes || `Backfilled from wallet_ledger pair ${batchCode}`,
        });

        if (opts.dryRun) {
          created.push({ ref: batchCode, wallet, from_coin: r.from_coin, to_coin: r.to_coin, from_amount: fromAmt, to_amount: toAmt, status: partial.status, dry_run: true });
          continue;
        }

        const saved = await this.batchRepo.save(this.batchRepo.create(partial));
        await this.ledgerRepo.createQueryBuilder().update()
          .set({ linked_batch_id: saved.id })
          .where('external_ref = :ref', { ref: batchCode }).execute();
        created.push({ ref: batchCode, id: saved.id, wallet, from_coin: r.from_coin, to_coin: r.to_coin, from_amount: fromAmt, to_amount: toAmt, status: saved.status });
      } catch (err) {
        errored.push({ ref: r.ref, error: (err as any)?.message });
      }
    }

    if (!opts.dryRun && (created.length > 0 || errored.length > 0)) {
      await this.audit.log({
        actor_id: actor?.id, actor_email: actor?.email,
        action: 'backfill_orphan_conversions',
        entity_type: 'treasury_batch',
        entity_id: 'bulk',
        details: `created=${created.length}, skipped=${skipped.length}, errored=${errored.length}`,
      });
    }

    return { dry_run: !!opts.dryRun, created, skipped, errored, total_pairs: rows.length };
  }

  async recordExchangeConversion(input: {
    wallet: 'BINANCE' | 'OKX' | 'AED_TREASURY';
    from_coin: string;
    to_coin: string;
    from_amount: string;
    to_amount: string;
    event_at?: string | Date;
    notes?: string;
  }, actor?: any) {
    const wallet = String(input.wallet || '').toUpperCase();
    if (!['BINANCE', 'OKX', 'AED_TREASURY'].includes(wallet)) {
      throw new BadRequestException(`Unknown exchange wallet '${input.wallet}'`);
    }
    const fromCoin = String(input.from_coin || '').toUpperCase();
    const toCoin = String(input.to_coin || '').toUpperCase();
    if (fromCoin === toCoin) throw new BadRequestException('From and To coins must differ');
    const fromAmt = parseFloat(input.from_amount);
    const toAmt = parseFloat(input.to_amount);
    if (!(fromAmt > 0) || !(toAmt > 0)) throw new BadRequestException('Amounts must be positive');
    const eventAt = input.event_at ? new Date(input.event_at) : new Date();
    const eventDate = (() => {
      // Preserve user-entered date but adopt current time-of-day so the
      // batch surfaces at top of the Wallet Ledger.
      if (!input.event_at) return eventAt;
      const wasDateOnly = typeof input.event_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.event_at);
      if (wasDateOnly) {
        const now = new Date();
        eventAt.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
      }
      return eventAt;
    })();

    // STEP 1 — Create the batch entity.
    const prefix = wallet === 'BINANCE' ? 'binance' : wallet === 'OKX' ? 'okx' : 'aed';
    const batchCode = await this.nextBatchCode(prefix);
    const FIAT = ['AED', 'USD', 'EUR', 'GBP'];
    const isUsdtTarget = toCoin === 'USDT';
    const isFiatTarget = FIAT.includes(toCoin);
    const rate = fromAmt > 0 ? (toAmt / fromAmt).toFixed(8) : null;

    const batchData: any = {
      batch_code: batchCode,
      name: `${wallet} ${fromCoin} → ${toCoin} ${eventDate.toISOString().slice(0, 10)}`,
      source_gateway: wallet,
      source_wallet: wallet,
      destination_exchange: wallet,
      destination_wallet: wallet,
      coin: fromCoin,
      received_crypto_amount: fromAmt.toFixed(8),
      total_crypto_amount: fromAmt.toFixed(8),
      exchange_received_at: eventDate,
      settlement_reference: `${batchCode} auto-conversion`,
      notes: input.notes || `${fromAmt} ${fromCoin} → ${toAmt} ${toCoin} on ${wallet}`,
    };

    if (isUsdtTarget) {
      // crypto → USDT path (or USDT → USDT if both — already blocked above)
      batchData.usdt_amount = toAmt.toFixed(8);
      batchData.usdt_conversion_rate = rate;
      batchData.usdt_conversion_date = eventDate;
      batchData.usdt_conversion_reference = `${batchCode} ${fromCoin}→${toCoin}`;
      batchData.status = 'converted_to_usdt';
    } else if (isFiatTarget) {
      // DIRECT crypto → fiat path (e.g. BTC → AED on OTC, USDT → AED)
      // We use the AED-conversion fields on the batch. applyBatchLedger
      // STEP 3 will fan-out -fromCoin / +fiat on the exchange.
      batchData.crypto_converted = fromAmt.toFixed(8);
      batchData.fiat_received = toAmt.toFixed(8);
      batchData.fiat_currency = toCoin;
      batchData.conversion_rate = rate;
      batchData.conversion_date = eventDate;
      batchData.status = 'converted_to_aed';
    } else {
      // crypto → crypto (e.g. BTC → ETH)
      batchData.status = 'received_in_exchange';
    }

    const batch = this.batchRepo.create(batchData as Partial<TreasuryBatch>);
    const savedBatch = await this.batchRepo.save(batch);

    // STEP 2 — Auto-assign unbatched receipts on this exchange + coin so the
    // audit chain (Customer → Invoice → TX → Batch) is preserved without
    // requiring manual selection.
    const candidates = await this.rechargeRepo
      .createQueryBuilder('r')
      .leftJoin('treasury_movements', 'm', 'm.recharge_id::text = r.id::text')
      .where('UPPER(r.crypto_coin) = :coin', { coin: fromCoin })
      .andWhere('LOWER(r.payment_gateway) LIKE :gw', { gw: `%${wallet.toLowerCase()}%` })
      .andWhere('(m.id IS NULL OR m.treasury_batch_id IS NULL)')
      .andWhere('r.tx_hash IS NOT NULL')
      .orderBy('r.payment_date', 'ASC')
      .getMany();
    let runningSum = 0;
    const assignedIds: string[] = [];
    for (const rch of candidates) {
      const amt = parseFloat(rch.crypto_amount || '0');
      if (runningSum + amt - 0.00000001 > fromAmt) break; // would exceed
      runningSum += amt;
      let mov = await this.repo.findOne({ where: { recharge_id: rch.id } });
      if (!mov) {
        mov = this.repo.create({
          recharge_id: rch.id,
          customer_id: rch.customer_id,
          receiving_wallet: rch.wallet_address || wallet,
          receive_tx_hash: rch.tx_hash,
          total_usdt_received: '0',
        });
      }
      mov.treasury_batch_id = savedBatch.id;
      await this.repo.save(mov);
      assignedIds.push(rch.id);
      if (Math.abs(runningSum - fromAmt) < 0.00000001) break;
    }

    // STEP 3 — Fan out wallet ledger rows via the existing pipeline.
    savedBatch.status = this.resolveBatchStatus(savedBatch);
    await this.batchRepo.save(savedBatch);
    await this.applyBatchLedger(savedBatch);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'exchange_convert', entity_type: 'treasury_batch', entity_id: savedBatch.id,
      details: `${wallet}: ${fromAmt} ${fromCoin} → ${toAmt} ${toCoin} (${batchCode}, ${assignedIds.length}/${candidates.length} receipts assigned, sum ${runningSum.toFixed(8)})`,
    });

    return {
      batch: savedBatch,
      assigned_recharges_count: assignedIds.length,
      assigned_amount: runningSum.toFixed(8),
      remaining_unbatched_amount: (fromAmt - runningSum).toFixed(8),
    };
  }

  /**
   * Idempotently writes wallet_ledger rows for each completed batch step.
   * Re-runs on every batch save and skips steps whose external_ref already
   * exists.  This is what makes a Treasury Transfer also update Binance USDT
   * + Binance BTC balance + Wio AED balance — without it, the batch only
   * advances recharge statuses (the bug the user reported).
   */
  private async applyBatchLedger(batch: TreasuryBatch) {
    // Helper: combine the user-entered DATE (which parses to 00:00 UTC and
    // would sink below the day's deposits stamped at e.g. 14:00 UTC) with
    // the batch's actual save time. Preserves the user's chosen date while
    // letting freshly-saved entries surface at the top of the Wallet Ledger.
    const stampNowTime = (userDate?: string | Date | null): Date => {
      const updated = batch.updated_at || batch.created_at || new Date();
      if (!userDate) return new Date(updated);
      const d = new Date(userDate);
      if (isNaN(d.getTime())) return new Date(updated);
      const u = new Date(updated);
      d.setUTCHours(u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
      return d;
    };
    const exchangeWallet: WalletCode = (() => {
      const e = (batch.destination_exchange || '').toLowerCase();
      if (e.includes('okx')) return 'OKX';
      return 'BINANCE';
    })();
    const sourceWallet: WalletCode = (() => {
      const s = (batch.source_wallet || batch.source_gateway || '').toLowerCase();
      if (s.includes('btcpay')) return 'BTCPAY';
      if (s.includes('oxapay')) return 'OXAPAY';
      if (s.includes('binance')) return 'BINANCE';
      if (s.includes('okx')) return 'OKX';
      return exchangeWallet;
    })();
    const coin = (batch.coin || 'BTC').toUpperCase();
    const network = batch.network || coin;
    const txHash = batch.settlement_tx_hash || batch.settlement_reference || batch.batch_code;
    const sweptAmount = parseFloat(
      batch.received_crypto_amount || batch.total_crypto_amount || '0',
    );

    // STEP 1 — Sweep: -coin from source, +coin at exchange (skip if source IS
    // the exchange — i.e. a direct-on-exchange batch — those deposits were
    // already recorded when the recharge fanned out individually).
    if (sweptAmount > 0 && sourceWallet !== exchangeWallet) {
      const sweepRef = `${batch.batch_code}-SWEEP`;
      const existing = await this.wallets.findByExternalRef(sweepRef);
      if (!existing.length) {
        await this.wallets.recordTransferPair({
          from_wallet: sourceWallet,
          to_wallet: exchangeWallet,
          coin,
          network,
          amount: sweptAmount,
          tx_hash: txHash,
          external_ref: sweepRef,
          event_at: stampNowTime(batch.exchange_received_at || batch.period_end || batch.period_start || null),
          notes: `${batch.batch_code} sweep: ${batch.source_gateway || sourceWallet} → ${batch.destination_exchange || exchangeWallet}`,
        });
      }
    }

    // STEP 2 — Conversion to USDT (-coin from exchange, +USDT at exchange).
    // Skip if the source coin already IS USDT.
    const usdtAmount = parseFloat(batch.usdt_amount || '0');
    if (usdtAmount > 0 && coin !== 'USDT' && sweptAmount > 0) {
      const convRef = `${batch.batch_code}-CONV-USDT`;
      const existing = await this.wallets.findByExternalRef(convRef);
      if (!existing.length) {
        await this.wallets.recordConvertPair({
          wallet: exchangeWallet,
          from_coin: coin,
          from_amount: sweptAmount,
          to_coin: 'USDT',
          to_amount: usdtAmount,
          external_ref: convRef,
          event_at: stampNowTime(batch.usdt_conversion_date || batch.exchange_received_at || null),
          notes: `${batch.batch_code}: ${coin} → USDT conversion (${batch.usdt_conversion_reference || 'on-exchange'})`,
        });
      }
    }

    // STEP 3 — Conversion to AED (-source coin from exchange, +AED at exchange).
    // Supports BOTH paths:
    //   (a) Classic: USDT → AED (when a USDT step preceded). from_coin='USDT'.
    //   (b) Direct:  CRYPTO → AED (no USDT step). from_coin = batch.coin
    //       (e.g. BTC → AED on OTC desk).
    const aedAmount = parseFloat(batch.fiat_received || '0');
    const usdtConverted = parseFloat(batch.crypto_converted || '0');
    const hadUsdtStep = parseFloat(batch.usdt_amount || '0') > 0;
    if (aedAmount > 0 && usdtConverted > 0) {
      const convRef = `${batch.batch_code}-CONV-AED`;
      const existing = await this.wallets.findByExternalRef(convRef);
      if (!existing.length) {
        const sourceCoin = hadUsdtStep ? 'USDT' : String(batch.coin || 'USDT').toUpperCase();
        await this.wallets.recordConvertPair({
          wallet: exchangeWallet,
          from_coin: sourceCoin,
          from_amount: usdtConverted,
          to_coin: (batch.fiat_currency || 'AED').toUpperCase(),
          to_amount: aedAmount,
          external_ref: convRef,
          event_at: stampNowTime(batch.conversion_date || batch.usdt_conversion_date || null),
          notes: `${batch.batch_code}: ${sourceCoin} → ${(batch.fiat_currency || 'AED').toUpperCase()} conversion`,
        });
      }
    }

    // STEP 4 — Bank deposit (-AED from exchange, +AED at WIO_BANK).
    const wioAmount = parseFloat(batch.net_bank_deposit_amount || batch.fiat_received || '0');
    if (wioAmount > 0 && batch.bank_reference) {
      const wioRef = `${batch.batch_code}-WIO`;
      const existing = await this.wallets.findByExternalRef(wioRef);
      if (!existing.length) {
        await this.wallets.recordTransferPair({
          from_wallet: exchangeWallet,
          to_wallet: 'WIO_BANK',
          coin: (batch.fiat_currency || 'AED').toUpperCase(),
          amount: wioAmount,
          tx_hash: batch.bank_reference,
          external_ref: wioRef,
          event_at: stampNowTime(batch.bank_deposit_date || null),
          notes: `${batch.batch_code}: Withdrawn to ${batch.bank_name || 'Wio Bank'}`,
        });
      }
    }
  }

  /* ============================================================
   *  REPORTS: Customer Profit by Conversion (item #6)
   *  ============================================================
   * For every treasury_movement (customer recharge tied to a batch) we
   * compute the spread between what the customer paid (invoice fiat, ex.
   * EUR/USD) and what we actually received in AED after conversion + fees.
   * Surfaces real margin per customer/per batch.
   */
  async customerProfitByConversion() {
    const FX = { AED: 1, USD: 3.6725, EUR: 4.0, GBP: 4.6 } as Record<string, number>;
    const movements = await this.repo.find();
    const recharges = await this.rechargeRepo.find({ relations: ['customer'] });
    const rechargeById = new Map(recharges.map((r) => [r.id, r]));
    const batches = await this.batchRepo.find();
    const batchById = new Map(batches.map((b) => [b.id, b]));
    const rows = movements.map((m) => {
      const r = rechargeById.get(m.recharge_id) as any;
      const b = m.treasury_batch_id ? batchById.get(m.treasury_batch_id) as any : null;
      if (!r || !b) return null;
      const invoiceCcy = (r.currency || 'USD').toUpperCase();
      const invoiceAmt = parseFloat(r.amount || '0');
      const invoiceAed = invoiceAmt * (FX[invoiceCcy] || 1);
      const fiatReceivedAed = parseFloat(b.fiat_received || b.net_bank_deposit_amount || '0');
      const batchAllRecharges = movements.filter((x) => x.treasury_batch_id === m.treasury_batch_id);
      const totalInvoiceAedInBatch = batchAllRecharges.reduce((s: number, x) => {
        const xr = rechargeById.get(x.recharge_id) as any;
        if (!xr) return s;
        return s + parseFloat(xr.amount || '0') * (FX[(xr.currency || 'USD').toUpperCase()] || 1);
      }, 0);
      const share = totalInvoiceAedInBatch > 0 ? invoiceAed / totalInvoiceAedInBatch : 0;
      const allocatedAedReceived = fiatReceivedAed * share;
      const profit = allocatedAedReceived - invoiceAed;
      const margin = invoiceAed > 0 ? profit / invoiceAed : 0;
      return {
        recharge_code: r.recharge_code,
        customer_name: r.customer?.full_name || r.customer?.email || 'Unknown',
        invoice_amount: invoiceAmt,
        invoice_currency: invoiceCcy,
        invoice_amount_aed: invoiceAed,
        batch_code: b.batch_code,
        batch_status: b.status,
        allocated_aed_received: allocatedAedReceived,
        profit_aed: profit,
        margin_pct: margin * 100,
        recharge_id: r.id,
      };
    }).filter((x) => x !== null) as any[];
    const totals = {
      rows: rows.length,
      total_invoice_aed: rows.reduce((s, r) => s + r.invoice_amount_aed, 0),
      total_received_aed: rows.reduce((s, r) => s + r.allocated_aed_received, 0),
      total_profit_aed: rows.reduce((s, r) => s + r.profit_aed, 0),
      avg_margin_pct: 0,
    };
    totals.avg_margin_pct = totals.total_invoice_aed > 0 ? (totals.total_profit_aed / totals.total_invoice_aed) * 100 : 0;
    return { totals, rows };
  }

  /* ============================================================
   *  AUDIT CHAIN for a single recharge (item #2 backing data)
   *  ============================================================
   * Returns the full lifecycle of a recharge as a list of "links" each
   * one being { stage, status, label, ref, when }, so the frontend can
   * render a visual chain with green/yellow/red pills.
   */
  async auditChainForRecharge(rechargeId: string) {
    const recharge = await this.rechargeRepo.findOne({ where: { id: rechargeId }, relations: ['customer'] });
    if (!recharge) throw new Error('recharge_not_found');
    const cryptos = await this.cryptoRepo.find({ where: { recharge_id: rechargeId } });
    const movement = await this.repo.findOne({ where: { recharge_id: rechargeId } });
    const batch = movement?.treasury_batch_id ? await this.batchRepo.findOne({ where: { id: movement.treasury_batch_id } }) as any : null;
    const ledgerForBatch = batch ? await this.ledgerRepo.find({ where: { linked_batch_id: batch.id } }) : [];

    const chain: any[] = [];
    // 1. Customer recharge
    chain.push({
      stage: 'customer',
      status: 'done',
      label: 'Customer Recharge',
      ref: recharge.recharge_code,
      when: recharge.created_at,
      detail: `${recharge.amount} ${recharge.currency} from ${recharge.customer?.full_name || recharge.customer?.email}`,
    });
    // 2. Gateway TX (OxaPay / BTCPay / Direct)
    chain.push({
      stage: 'gateway',
      status: cryptos.length > 0 ? 'done' : 'pending',
      label: cryptos.length > 0 ? `${cryptos[0].coin} Received` : 'Awaiting On-chain',
      ref: cryptos[0]?.tx_hash || recharge.tx_hash || null,
      when: cryptos[0]?.created_at || null,
      detail: cryptos[0] ? `${cryptos[0].crypto_amount} ${cryptos[0].coin}` : null,
    });
    // 3. Magnus credit
    chain.push({
      stage: 'magnus',
      status: recharge.magnus_credited_at ? 'done' : 'pending',
      label: 'Magnus Credit',
      ref: null,
      when: recharge.magnus_credited_at,
      detail: recharge.magnus_credited_at ? 'Customer balance funded' : 'Not credited yet',
    });
    // 4. Exchange sweep
    chain.push({
      stage: 'sweep',
      status: batch ? 'done' : 'pending',
      label: 'Exchange Sweep',
      ref: batch?.batch_code || null,
      when: batch?.exchange_received_at || batch?.created_at || null,
      detail: batch ? `${batch.received_crypto_amount || batch.total_crypto_amount} ${batch.coin} → ${batch.destination_exchange || batch.destination_wallet}` : 'Not assigned to a batch yet',
    });
    // 5. USDT conversion
    chain.push({
      stage: 'usdt',
      status: batch?.usdt_amount ? 'done' : (batch ? 'pending' : 'pending'),
      label: 'Convert to USDT',
      ref: batch?.usdt_conversion_reference || null,
      when: batch?.usdt_conversion_date || null,
      detail: batch?.usdt_amount ? `${batch.usdt_amount} USDT @ ${batch.usdt_conversion_rate}` : null,
    });
    // 6. AED conversion
    chain.push({
      stage: 'aed',
      status: batch?.fiat_received ? 'done' : 'pending',
      label: 'Convert to AED',
      ref: null,
      when: batch?.conversion_date || null,
      detail: batch?.fiat_received ? `${batch.fiat_received} AED @ ${batch.conversion_rate}` : null,
    });
    // 7. Wio bank deposit
    chain.push({
      stage: 'wio',
      status: batch?.bank_reference ? 'done' : 'pending',
      label: 'Wio Bank Deposit',
      ref: batch?.bank_reference || null,
      when: batch?.bank_deposit_date || null,
      detail: batch?.net_bank_deposit_amount ? `${batch.net_bank_deposit_amount} AED net (fee ${batch.bank_fee_aed || 0})` : null,
    });
    return { recharge, batch, cryptos, ledger: ledgerForBatch, chain };
  }

  /* ============================================================
   *  BANK STATEMENT IMPORT + AUTO-MATCH (item #4)
   *  ============================================================
   * Accepts a parsed Wio statement (JSON array of {date, ref, amount,
   * description}).  For each row we look for an exact match in
   * wallet_ledgers (wallet=WIO_BANK, tx_hash=ref, amount=amount), and
   * mark match/unmatch.  Unmatched rows are surfaced so the operator
   * can convert them into a cashout in one click.
   */
  async importBankStatement(input: { rows: Array<{ date: string; ref?: string; amount: number; description?: string }>; }, _actor?: any) {
    const wioRows = await this.ledgerRepo.find({ where: { wallet: 'WIO_BANK' as any } });
    const byRef = new Map<string, any>();
    const byAmount = new Map<string, any[]>();
    for (const r of wioRows) {
      if (r.tx_hash) byRef.set(String(r.tx_hash).toLowerCase(), r);
      const amt = Math.round(parseFloat(r.amount || '0') * 100) / 100;
      const arr = byAmount.get(amt.toFixed(2)) || [];
      arr.push(r);
      byAmount.set(amt.toFixed(2), arr);
    }
    const matched: any[] = [];
    const unmatched: any[] = [];
    for (const row of input.rows || []) {
      const refKey = (row.ref || '').toLowerCase();
      let hit: any = refKey ? byRef.get(refKey) : null;
      if (!hit) {
        const arr = byAmount.get(Number(row.amount).toFixed(2)) || [];
        if (arr.length === 1) hit = arr[0];
      }
      if (hit) {
        matched.push({ statement_row: row, ledger_row_id: hit.id, ledger_ref: hit.external_ref, ledger_tx_hash: hit.tx_hash });
      } else {
        unmatched.push(row);
      }
    }
    return {
      total_in_statement: (input.rows || []).length,
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      matched,
      unmatched,
    };
  }
}
