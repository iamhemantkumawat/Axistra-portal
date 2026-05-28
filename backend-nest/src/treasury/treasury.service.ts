import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletCode } from '../entities/wallet-ledger.entity';

@Injectable()
export class TreasuryService {
  constructor(
    @InjectRepository(TreasuryMovement) private repo: Repository<TreasuryMovement>,
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(TreasuryBatch) private batchRepo: Repository<TreasuryBatch>,
    @InjectRepository(CryptoTransaction) private cryptoRepo: Repository<CryptoTransaction>,
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
    const totals = {
      total_recharges: all.length,
      pending: all.filter((r) => !r.reconciled && r.status !== 'mismatch' && r.status !== 'refunded').length,
      mismatch: all.filter((r) => r.status === 'mismatch').length,
      reconciled: all.filter((r) => r.reconciled).length,
      ready_for_settlement: readyForSettlement.length,
      open_batches: batches.filter((b: any) => b.status !== 'reconciled').length,
      total_batch_invoice_amount: batches.reduce((s: number, b: any) => s + parseFloat(b.total_invoice_amount || '0'), 0),
      total_bank_deposited: batches.reduce((s: number, b: any) => s + parseFloat(b.net_bank_deposit_amount || b.fiat_received || '0'), 0),
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

  async listBatches() {
    const batches = await this.batchRepo.find({ order: { created_at: 'DESC' } });
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
      details: `${batch.batch_code} unlinked ${linkedMovements.length} movement(s)`,
    });
    return { deleted: true, unlinked_movements: linkedMovements.length };
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
   * Idempotently writes wallet_ledger rows for each completed batch step.
   * Re-runs on every batch save and skips steps whose external_ref already
   * exists.  This is what makes a Treasury Transfer also update Binance USDT
   * + Binance BTC balance + Wio AED balance — without it, the batch only
   * advances recharge statuses (the bug the user reported).
   */
  private async applyBatchLedger(batch: TreasuryBatch) {
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
          event_at: batch.exchange_received_at || batch.period_end || batch.period_start || new Date(),
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
          event_at: batch.usdt_conversion_date || batch.exchange_received_at || new Date(),
          notes: `${batch.batch_code}: ${coin} → USDT conversion (${batch.usdt_conversion_reference || 'on-exchange'})`,
        });
      }
    }

    // STEP 3 — Conversion to AED (-USDT from exchange, +AED at exchange).
    const aedAmount = parseFloat(batch.fiat_received || '0');
    const usdtConverted = parseFloat(batch.crypto_converted || '0');
    if (aedAmount > 0 && usdtConverted > 0) {
      const convRef = `${batch.batch_code}-CONV-AED`;
      const existing = await this.wallets.findByExternalRef(convRef);
      if (!existing.length) {
        await this.wallets.recordConvertPair({
          wallet: exchangeWallet,
          from_coin: 'USDT',
          from_amount: usdtConverted,
          to_coin: (batch.fiat_currency || 'AED').toUpperCase(),
          to_amount: aedAmount,
          external_ref: convRef,
          event_at: batch.conversion_date || batch.usdt_conversion_date || new Date(),
          notes: `${batch.batch_code}: USDT → AED conversion`,
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
          event_at: batch.bank_deposit_date || new Date(),
          notes: `${batch.batch_code}: Withdrawn to ${batch.bank_name || 'Wio Bank'}`,
        });
      }
    }
  }
}
