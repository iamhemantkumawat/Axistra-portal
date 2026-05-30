import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { WalletLedger, WalletCode } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { TreasuryBatch } from '../entities/treasury-batch.entity';
import { Expense } from '../entities/expense.entity';
import { AuditService } from '../audit/audit.service';
import { buildConversionBatch } from '../treasury/batch-builder';

export const WALLETS: { code: WalletCode; label: string; type: 'crypto' | 'exchange' | 'bank'; default_coin: string }[] = [
  { code: 'OXAPAY',   label: 'OxaPay',   type: 'crypto',   default_coin: 'USDT' },
  { code: 'BTCPAY',   label: 'BTCPay',   type: 'crypto',   default_coin: 'BTC' },
  { code: 'BINANCE',  label: 'Binance',  type: 'exchange', default_coin: 'USDT' },
  { code: 'OKX',      label: 'OKX',      type: 'exchange', default_coin: 'USDT' },
  { code: 'WIO_BANK', label: 'Wio Bank', type: 'bank',     default_coin: 'AED' },
];

function nextCode(prefix: string) {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${stamp}-${rand}`;
}

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>,
    @InjectRepository(Recharge) private recharges: Repository<Recharge>,
    @InjectRepository(TreasuryBatch) private batchRepo: Repository<TreasuryBatch>,
    @InjectRepository(Expense) private expenseRepo: Repository<Expense>,
    private audit: AuditService,
  ) {}

  async balances(wallet?: WalletCode) {
    const qb = this.ledger.createQueryBuilder('l')
      .select('l.wallet', 'wallet').addSelect('l.coin', 'coin')
      .addSelect('SUM(l.amount::numeric)', 'balance')
      .addSelect('COUNT(*)', 'tx_count');
    if (wallet) qb.where('l.wallet = :w', { w: wallet });
    qb.groupBy('l.wallet').addGroupBy('l.coin').orderBy('l.wallet').addOrderBy('l.coin');
    const rows = await qb.getRawMany();
    return rows.map((r) => ({ wallet: r.wallet, coin: r.coin, balance: parseFloat(r.balance), tx_count: parseInt(r.tx_count, 10) }));
  }

  async overview() {
    const all = await this.balances();
    const grouped: Record<string, any> = {};
    WALLETS.forEach((w) => { grouped[w.code] = { ...w, balances: [] }; });
    all.forEach((b) => { if (grouped[b.wallet]) grouped[b.wallet].balances.push({ coin: b.coin, balance: b.balance, tx_count: b.tx_count }); });
    return Object.values(grouped);
  }

  async ledgerFor(wallet: WalletCode, query: { from?: string; to?: string; coin?: string; tx_type?: string; search?: string; limit?: number; offset?: number }) {
    const qb = this.ledger.createQueryBuilder('l').where('l.wallet = :w', { w: wallet }).orderBy('l.event_at', 'DESC');
    if (query.coin) qb.andWhere('l.coin = :c', { c: query.coin.toUpperCase() });
    if (query.tx_type) qb.andWhere('l.tx_type = :t', { t: query.tx_type });
    if (query.from) qb.andWhere('l.event_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('l.event_at <= :to', { to: query.to });
    if (query.search) {
      const s = `%${query.search}%`;
      qb.andWhere('(l.tx_hash ILIKE :s OR l.external_ref ILIKE :s OR l.counterparty ILIKE :s OR l.notes ILIKE :s)', { s });
    }
    const limit = Math.min(query.limit || 100, 500);
    const offset = query.offset || 0;
    const [rows, total] = await qb.take(limit).skip(offset).getManyAndCount();
    return { rows, total, limit, offset, wallet };
  }

  /**
   * Reconciliation audit for a single wallet. Returns:
   *  - balance: same as overview (sum of all signed amounts grouped by coin)
   *  - duplicates: any tx_hash that has > 1 deposit row (should be impossible after the v10 dedupe)
   *  - missing_tx_hash: deposit rows whose tx_hash is null/empty (manual entries, conversions, etc.)
   *  - orphan_no_source: deposit rows whose linked_recharge_id is NULL (can't trace back to a customer)
   * Used by the Wallet Ledger "Reconcile with on-chain wallet" modal so the
   * accountant can find why the in-portal balance differs from the actual
   * BTCPay store / OxaPay merchant / Binance exchange total.
   */
  async auditWallet(walletCode: string) {
    const wallet = String(walletCode || '').toUpperCase();
    const rows = await this.ledger.find({ where: { wallet: wallet as any }, order: { event_at: 'DESC', created_at: 'DESC' } });

    const balanceByCoin = new Map<string, number>();
    rows.forEach((r) => {
      const c = String(r.coin || '').toUpperCase();
      balanceByCoin.set(c, (balanceByCoin.get(c) || 0) + parseFloat(r.amount || '0'));
    });

    // Per-coin × tx_type breakdown so the accountant can see at a glance
    // which row types contribute to a given coin's balance. Critical for
    // spotting "BTC has 14 deposits +X but only 1 convert_from -Y, so the
    // extra (X-Y) is what's drifting".
    type Bucket = { count: number; total: number };
    const breakdown = new Map<string, Map<string, Bucket>>();
    rows.forEach((r) => {
      const coin = String(r.coin || '').toUpperCase();
      const type = String(r.tx_type || 'unknown');
      const amt = parseFloat(r.amount || '0');
      if (!breakdown.has(coin)) breakdown.set(coin, new Map());
      const inner = breakdown.get(coin)!;
      if (!inner.has(type)) inner.set(type, { count: 0, total: 0 });
      const b = inner.get(type)!;
      b.count += 1;
      b.total += amt;
    });
    const breakdownOut = Array.from(breakdown.entries()).map(([coin, types]) => ({
      coin,
      balance: (balanceByCoin.get(coin) || 0).toFixed(8),
      types: Array.from(types.entries())
        .map(([tx_type, b]) => ({ tx_type, count: b.count, total: b.total.toFixed(8) }))
        .sort((a, b) => a.tx_type.localeCompare(b.tx_type)),
    })).sort((a, b) => a.coin.localeCompare(b.coin));

    const hashGroups = new Map<string, typeof rows>();
    const noHash: typeof rows = [];
    rows.forEach((r) => {
      if (r.tx_type !== 'deposit') return;
      if (!r.tx_hash) { noHash.push(r); return; }
      const k = r.tx_hash;
      if (!hashGroups.has(k)) hashGroups.set(k, []);
      hashGroups.get(k)!.push(r);
    });

    const duplicates: any[] = [];
    hashGroups.forEach((grp, hash) => {
      if (grp.length > 1) {
        duplicates.push({
          tx_hash: hash,
          count: grp.length,
          total_amount: grp.reduce((s, r) => s + parseFloat(r.amount || '0'), 0).toFixed(8),
          rows: grp.map((r) => ({
            id: r.id, amount: r.amount, coin: r.coin, event_at: r.event_at,
            counterparty: r.counterparty, external_ref: r.external_ref, notes: r.notes,
          })),
        });
      }
    });

    const orphans = rows.filter((r) => r.tx_type === 'deposit' && !r.linked_recharge_id);

    return {
      wallet,
      balance: Array.from(balanceByCoin.entries()).map(([coin, amount]) => ({ coin, amount: amount.toFixed(8) })),
      breakdown: breakdownOut,
      deposit_row_count: rows.filter((r) => r.tx_type === 'deposit').length,
      duplicates,
      missing_tx_hash: {
        count: noHash.length,
        total_amount: noHash.reduce((s, r) => s + parseFloat(r.amount || '0'), 0).toFixed(8),
        rows: noHash.slice(0, 50).map((r) => ({
          id: r.id, amount: r.amount, coin: r.coin, event_at: r.event_at,
          counterparty: r.counterparty, external_ref: r.external_ref, notes: r.notes,
        })),
      },
      orphan_no_recharge: {
        count: orphans.length,
        total_amount: orphans.reduce((s, r) => s + parseFloat(r.amount || '0'), 0).toFixed(8),
        rows: orphans.slice(0, 50).map((r) => ({
          id: r.id, amount: r.amount, coin: r.coin, event_at: r.event_at,
          tx_hash: r.tx_hash, counterparty: r.counterparty, external_ref: r.external_ref, notes: r.notes,
        })),
      },
    };
  }

  async getOne(id: string) {
    const row = await this.ledger.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Admin-only delete of a single wallet_ledger row.
   *
   * Note: rows fan-out from recharges / treasury movements / expenses are
   * idempotently recreated by their source on the next save. This delete
   * is intended for one-off cleanup (test rows, manual mistakes). For a
   * full reversal of a recharge/expense/movement, delete the source record
   * instead — that already cascades to the ledger.
   *
   * If the row is linked (linked_ledger_id) we also delete the paired row
   * so the double-entry remains balanced.
   */
  async deleteLedgerRow(id: string, actor?: any) {
    const row = await this.ledger.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Ledger row not found');
    const pairedId = row.linked_ledger_id;
    await this.ledger.delete({ id: row.id });
    if (pairedId) {
      await this.ledger.delete({ id: pairedId }).catch(() => undefined);
    }
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_ledger_delete', entity_type: 'wallet_ledger', entity_id: row.id,
      details: `Deleted ${row.wallet} ${row.coin} ${row.amount}${pairedId ? ` (paired ${pairedId})` : ''}`,
    });
    return { deleted: true, paired_deleted: !!pairedId };
  }

  // ----- Actions -----

  /**
   * Idempotent two-leg wallet transfer (e.g. BTCPay → Binance sweep) used by
   * Treasury batch fan-out. Writes:  -amount coin on from_wallet, +amount coin
   * on to_wallet. Dedupe is enforced by the caller via findByExternalRef.
   */
  async recordTransferPair(input: {
    from_wallet: WalletCode;
    to_wallet: WalletCode;
    coin: string;
    network?: string;
    amount: number;
    tx_hash?: string;
    external_ref: string;
    event_at: Date;
    notes?: string;
  }) {
    if (input.from_wallet === input.to_wallet) return;
    const coin = String(input.coin || '').toUpperCase();
    const out = await this.ledger.save(this.ledger.create({
      wallet: input.from_wallet,
      coin,
      network: input.network,
      amount: (-input.amount).toFixed(8),
      tx_type: 'batch_out' as any,
      external_ref: input.external_ref,
      tx_hash: input.tx_hash,
      counterparty: input.to_wallet,
      notes: input.notes,
      event_at: input.event_at,
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: input.to_wallet,
      coin,
      network: input.network,
      amount: input.amount.toFixed(8),
      tx_type: 'batch_in' as any,
      external_ref: input.external_ref,
      tx_hash: input.tx_hash,
      counterparty: input.from_wallet,
      linked_ledger_id: out.id,
      notes: input.notes,
      event_at: input.event_at,
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);
    return { out, in: inn };
  }

  /**
   * Idempotent in-wallet conversion (e.g. BTC → USDT on Binance) used by
   * Treasury batch fan-out. Writes a `convert_from` and a `convert_to` row
   * on the same wallet with a shared external_ref.
   */
  async recordConvertPair(input: {
    wallet: WalletCode;
    from_coin: string;
    from_amount: number;
    to_coin: string;
    to_amount: number;
    external_ref: string;
    event_at: Date;
    notes?: string;
  }) {
    const fromCoin = String(input.from_coin || '').toUpperCase();
    const toCoin = String(input.to_coin || '').toUpperCase();
    if (fromCoin === toCoin) return;
    const rate = input.from_amount > 0 ? (input.to_amount / input.from_amount).toFixed(8) : '0';
    const out = await this.ledger.save(this.ledger.create({
      wallet: input.wallet,
      coin: fromCoin,
      amount: (-input.from_amount).toFixed(8),
      tx_type: 'convert_from' as any,
      external_ref: input.external_ref,
      rate_used: rate,
      notes: input.notes,
      event_at: input.event_at,
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: input.wallet,
      coin: toCoin,
      amount: input.to_amount.toFixed(8),
      tx_type: 'convert_to' as any,
      external_ref: input.external_ref,
      rate_used: rate,
      linked_ledger_id: out.id,
      notes: input.notes,
      event_at: input.event_at,
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);
    return { out, in: inn };
  }

  async findByExternalRef(ref: string) {
    return this.ledger.find({ where: { external_ref: ref } });
  }

  async sendBatch(input: {
    from_wallet: WalletCode;
    to_wallet: WalletCode;
    coin: string;
    network?: string;
    amount: string;
    fee_amount?: string;
    received_amount?: string;
    tx_hash?: string;
    notes?: string;
    ledger_ids?: string[]; // which deposits this batch represents
  }, actor?: any) {
    if (input.from_wallet === input.to_wallet) throw new BadRequestException('Same wallet');
    const amt = parseFloat(input.amount);
    if (!(amt > 0)) throw new BadRequestException('Amount must be > 0');
    const fee = parseFloat(input.fee_amount || '0');
    const received = parseFloat(input.received_amount || String(amt - fee));
    const batch_id = nextCode(`${input.from_wallet.slice(0, 3)}-${input.to_wallet.slice(0, 3)}`);
    const coin = input.coin.toUpperCase();

    const out = await this.ledger.save(this.ledger.create({
      wallet: input.from_wallet, coin, network: input.network,
      amount: (-amt).toFixed(8), tx_type: 'batch_out',
      external_ref: batch_id, tx_hash: input.tx_hash,
      counterparty: input.to_wallet, fee_amount: fee.toFixed(8), fee_currency: coin,
      notes: input.notes, actor_email: actor?.email, event_at: new Date(),
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: input.to_wallet, coin, network: input.network,
      amount: received.toFixed(8), tx_type: 'batch_in',
      external_ref: batch_id, tx_hash: input.tx_hash,
      counterparty: input.from_wallet, linked_ledger_id: out.id,
      notes: input.notes, actor_email: actor?.email, event_at: new Date(),
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);

    // Tag the source deposit ledger rows with this batch id so we can trace
    if (input.ledger_ids?.length) {
      await this.ledger.createQueryBuilder()
        .update(WalletLedger)
        .set({ linked_batch_id: batch_id })
        .whereInIds(input.ledger_ids).execute();
    }

    // If fee > 0 record a separate fee row on the source wallet
    if (fee > 0) {
      await this.ledger.save(this.ledger.create({
        wallet: input.from_wallet, coin, amount: (-fee).toFixed(8), tx_type: 'fee',
        external_ref: batch_id, notes: 'Network/transfer fee',
        actor_email: actor?.email, event_at: new Date(),
      }));
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_send_batch', entity_type: 'wallet_ledger', entity_id: out.id,
      details: `${input.from_wallet} → ${input.to_wallet}: ${amt} ${coin} (batch ${batch_id})`,
    });
    return { batch_id, out, in: inn };
  }

  async convert(input: {
    wallet: WalletCode;
    from_coin: string;
    to_coin: string;
    from_amount: string;
    rate: string;
    to_amount?: string;
    fee_amount?: string;
    fee_currency?: string;
    notes?: string;
    ledger_ids?: string[];
    event_at?: string | Date;
  }, actor?: any) {
    if (input.from_coin === input.to_coin) throw new BadRequestException('Same coin');
    const fromAmt = parseFloat(input.from_amount);
    if (!(fromAmt > 0)) throw new BadRequestException('From amount must be positive');
    const explicitTo = input.to_amount ? parseFloat(input.to_amount) : NaN;
    const explicitRate = input.rate ? parseFloat(input.rate) : NaN;
    // Prefer the actually-received amount the user typed. Derive the rate
    // from it. This matches real-world behaviour: exchange tells you the
    // resulting balance, you don't usually enter a rate by hand.
    let toAmt: number;
    let rate: number;
    if (Number.isFinite(explicitTo) && explicitTo > 0) {
      toAmt = explicitTo;
      rate = explicitTo / fromAmt;
    } else if (Number.isFinite(explicitRate) && explicitRate > 0) {
      rate = explicitRate;
      toAmt = fromAmt * explicitRate;
    } else {
      throw new BadRequestException('Either Received Amount or Rate is required');
    }
    const eventAt = (() => {
      // Same idea as treasury fan-out: keep user date but stamp current time
      // of day so freshly-saved conversions surface above the day's deposits.
      const u = input.event_at ? new Date(input.event_at) : new Date();
      if (isNaN(u.getTime())) return new Date();
      // If the user input was a yyyy-mm-dd string (parses to 00:00 UTC) bump
      // to the current time-of-day.
      const wasDateOnly = typeof input.event_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.event_at);
      if (wasDateOnly) {
        const now = new Date();
        u.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
      }
      return u;
    })();
    const conv_id = nextCode(`${input.wallet.slice(0, 3)}-CONV`);
    const fromCoin = input.from_coin.toUpperCase();
    const toCoin = input.to_coin.toUpperCase();

    const out = await this.ledger.save(this.ledger.create({
      wallet: input.wallet, coin: fromCoin, amount: (-fromAmt).toFixed(8),
      tx_type: 'convert_from', external_ref: conv_id,
      rate_used: rate.toFixed(8), notes: input.notes,
      actor_email: actor?.email, event_at: eventAt,
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: input.wallet, coin: toCoin, amount: toAmt.toFixed(8),
      tx_type: 'convert_to', external_ref: conv_id,
      rate_used: rate.toFixed(8), linked_ledger_id: out.id,
      notes: input.notes, actor_email: actor?.email, event_at: eventAt,
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);

    if (input.fee_amount && parseFloat(input.fee_amount) > 0) {
      await this.ledger.save(this.ledger.create({
        wallet: input.wallet, coin: (input.fee_currency || toCoin).toUpperCase(),
        amount: (-parseFloat(input.fee_amount)).toFixed(8), tx_type: 'fee',
        external_ref: conv_id, notes: 'Exchange/conversion fee',
        actor_email: actor?.email, event_at: eventAt,
      }));
    }

    if (input.ledger_ids?.length) {
      await this.ledger.createQueryBuilder().update(WalletLedger)
        .set({ linked_batch_id: conv_id })
        .whereInIds(input.ledger_ids).execute();
    }

    // Legacy convert() used to write only ledger rows and skip the
    // `treasury_batches` table, which made the conversion invisible on the
    // Crypto Treasury & Reconciliation page (it reads from batches, not the
    // ledger).  We now ALWAYS create a matching batch row when the wallet
    // is an exchange/treasury wallet — so every legacy or backdated
    // conversion lights up the Treasury feed automatically.
    let batchRow: TreasuryBatch | null = null;
    const batchEligible = ['BINANCE', 'OKX', 'AED_TREASURY'].includes(String(input.wallet).toUpperCase());
    if (batchEligible) {
      try {
        const partial = buildConversionBatch({
          wallet: input.wallet,
          from_coin: fromCoin,
          to_coin: toCoin,
          from_amount: fromAmt,
          to_amount: toAmt,
          batch_code: conv_id,
          event_at: eventAt,
          notes: input.notes,
        });
        batchRow = await this.batchRepo.save(this.batchRepo.create(partial));
        // Stamp linked_batch_id on the two ledger rows we just wrote so the
        // Wallet Ledger and Treasury views agree on which batch they belong
        // to.
        await this.ledger.createQueryBuilder().update(WalletLedger)
          .set({ linked_batch_id: batchRow.id })
          .where('external_ref = :ref', { ref: conv_id }).execute();
      } catch (err) {
        // A failed batch insert must not block the ledger write — operator
        // can rerun the backfill endpoint to repair.
        console.warn(`[wallets.convert] Failed to mirror batch for ${conv_id}:`, (err as any)?.message);
      }
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_convert', entity_type: 'wallet_ledger', entity_id: out.id,
      details: `${input.wallet}: ${fromAmt} ${fromCoin} → ${toAmt.toFixed(2)} ${toCoin} @ ${rate.toFixed(8)} (${conv_id}${batchRow ? ', batch=' + batchRow.batch_code : ''})`,
    });
    return { conv_id, batch: batchRow, out, in: inn };
  }

  async cashout(input: {
    from_wallet: WalletCode;
    amount_aed: string;
    bank_fee_aed?: string;
    bank_reference: string;
    bank_deposit_date?: string;
    notes?: string;
  }, actor?: any) {
    const aed = parseFloat(input.amount_aed);
    const fee = parseFloat(input.bank_fee_aed || '0');
    const net = aed - fee;
    const code = nextCode('CASH');

    const out = await this.ledger.save(this.ledger.create({
      wallet: input.from_wallet, coin: 'AED', amount: (-aed).toFixed(2),
      tx_type: 'cashout', external_ref: code, counterparty: 'WIO_BANK',
      fee_amount: fee.toFixed(2), fee_currency: 'AED',
      notes: input.notes, actor_email: actor?.email,
      event_at: input.bank_deposit_date ? new Date(input.bank_deposit_date) : new Date(),
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: 'WIO_BANK', coin: 'AED', amount: net.toFixed(2),
      tx_type: 'bank_deposit', external_ref: code, tx_hash: input.bank_reference,
      counterparty: input.from_wallet, linked_ledger_id: out.id,
      notes: input.notes, actor_email: actor?.email,
      event_at: input.bank_deposit_date ? new Date(input.bank_deposit_date) : new Date(),
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);

    // NOTE: We deliberately do NOT create a separate `tx_type:'fee'` ledger
    // row on the source wallet here.  The cashout row above already debits
    // the FULL gross amount (`-aed`), and the Wio deposit credits the NET
    // (`aed - fee`).  The 75 AED difference between them already accounts
    // for the wire fee — adding another `-fee` row would double-count it
    // and leave the source wallet sitting at a phantom negative balance.
    // The fee is preserved for audit on the cashout row via `fee_amount`.
    //
    // Instead, we record the wire fee as a proper EXPENSE row (so it flows
    // through P&L under "Bank Fees"), keyed idempotently by the cashout
    // code so re-running the cashout cannot duplicate the fee.
    let feeExpense: Expense | null = null;
    if (fee > 0) {
      feeExpense = await this.upsertCashoutFeeExpense({
        ref: code,
        bank_reference: input.bank_reference,
        fee_aed: fee,
        cashout_date: out.event_at,
        gross_aed: aed,
        net_aed: net,
        from_wallet: input.from_wallet,
        actor,
      });
    }

    // Mirror the cashout as a `treasury_batches` row of type "cashout" so it
    // shows in the Crypto Treasury & Reconciliation pages instead of only on
    // Wallet Ledger.  If the operator passed `link_batch_code`, we instead
    // close the chain on that existing batch (stamps bank_reference,
    // bank_deposit_date, net_bank_deposit_amount and status = 'reconciled').
    const linkBatchCode = (input as any).link_batch_code as string | undefined;
    let batchRow: TreasuryBatch | null = null;
    try {
      if (linkBatchCode) {
        const existing = await this.batchRepo.findOne({ where: { batch_code: linkBatchCode } });
        if (existing) {
          existing.bank_reference = input.bank_reference;
          existing.bank_deposit_date = out.event_at;
          existing.bank_fee_aed = fee.toFixed(2) as any;
          existing.net_bank_deposit_amount = net.toFixed(2) as any;
          existing.status = 'reconciled';
          batchRow = await this.batchRepo.save(existing);
          await this.ledger.createQueryBuilder().update(WalletLedger)
            .set({ linked_batch_id: batchRow.id })
            .where('external_ref = :ref', { ref: code }).execute();
        }
      }
      if (!batchRow) {
        batchRow = await this.batchRepo.save(this.batchRepo.create({
          batch_code: code,
          name: `${input.from_wallet} → Wio cashout ${out.event_at.toISOString().slice(0, 10)}`,
          source_gateway: input.from_wallet,
          source_wallet: input.from_wallet,
          destination_exchange: input.from_wallet,
          destination_wallet: 'WIO_BANK',
          coin: 'AED',
          received_crypto_amount: aed.toFixed(2),
          total_crypto_amount: aed.toFixed(2),
          crypto_converted: aed.toFixed(2),
          fiat_received: aed.toFixed(2),
          fiat_currency: 'AED',
          conversion_rate: '1.0000' as any,
          conversion_date: out.event_at,
          bank_reference: input.bank_reference,
          bank_deposit_date: out.event_at,
          bank_fee_aed: fee.toFixed(2) as any,
          net_bank_deposit_amount: net.toFixed(2) as any,
          status: 'reconciled',
          settlement_reference: `${code} cashout`,
          notes: input.notes || `${input.from_wallet} → Wio cashout, gross ${aed} AED, fee ${fee}, net ${net}`,
        }));
        await this.ledger.createQueryBuilder().update(WalletLedger)
          .set({ linked_batch_id: batchRow.id })
          .where('external_ref = :ref', { ref: code }).execute();
      }
    } catch (err) {
      console.warn(`[wallets.cashout] Failed to mirror batch for ${code}:`, (err as any)?.message);
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_cashout', entity_type: 'wallet_ledger', entity_id: out.id,
      details: `${input.from_wallet} → Wio: ${aed} AED (fee ${fee}), ref ${input.bank_reference}${batchRow ? ', batch=' + batchRow.batch_code : ''}`,
    });
    return { code, out, in: inn, fee_expense: feeExpense, batch: batchRow };
  }

  /**
   * Idempotently upsert a "Bank Fees" expense row for an OKX/Binance → Wio
   * cashout.  Re-running cashout deletion + re-creation will not duplicate
   * the fee because we key by `bank_reference = cashout code`.
   */
  private async upsertCashoutFeeExpense(args: {
    ref: string;
    bank_reference: string;
    fee_aed: number;
    cashout_date: Date;
    gross_aed: number;
    net_aed: number;
    from_wallet: string;
    actor?: any;
  }): Promise<Expense> {
    const existing = await this.expenseRepo.findOne({ where: { bank_reference: args.ref } });
    const stamp = `${String(args.cashout_date.getFullYear()).slice(-2)}${String(args.cashout_date.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.expenseRepo
      .createQueryBuilder('e').where('e.expense_code LIKE :p', { p: `EXP-${stamp}-%` }).getCount();
    const payload: Partial<Expense> = {
      expense_date: args.cashout_date,
      vendor_name: 'Wio Bank wire fee',
      category: 'Bank Fees',
      amount: args.fee_aed.toFixed(2),
      currency: 'AED',
      payment_method: 'Auto (cashout)',
      aed_value: args.fee_aed.toFixed(2),
      aed_rate: '1.0000',
      bank_reference: args.ref,
      source_wallet: 'WIO_BANK',
      notes: `Wire fee auto-recorded from ${args.from_wallet} cashout ${args.ref}. Gross ${args.gross_aed.toFixed(2)} AED → net ${args.net_aed.toFixed(2)} AED (bank ref: ${args.bank_reference}).`,
    };
    if (existing) {
      Object.assign(existing, payload);
      return await this.expenseRepo.save(existing);
    }
    return await this.expenseRepo.save(this.expenseRepo.create({
      ...payload,
      expense_code: `EXP-${stamp}-${String(count + 1).padStart(5, '0')}`,
    }));
  }

  async recordExpense(input: {
    wallet: WalletCode;
    coin: string;
    amount: string;
    expense_id?: string;
    vendor?: string;
    tx_hash?: string;
    notes?: string;
  }, actor?: any) {
    const amt = parseFloat(input.amount);
    return this.ledger.save(this.ledger.create({
      wallet: input.wallet, coin: input.coin.toUpperCase(),
      amount: (-amt).toFixed(8), tx_type: 'expense',
      linked_expense_id: input.expense_id,
      tx_hash: input.tx_hash, counterparty: input.vendor,
      notes: input.notes, actor_email: actor?.email, event_at: new Date(),
    }));
  }

  async removeExpenseLedger(expense_id: string) {
    if (!expense_id) return;
    await this.ledger.createQueryBuilder().delete().from(WalletLedger)
      .where('linked_expense_id = :id', { id: expense_id }).execute();
  }

  /**
   * Treasury → Wallet Ledger fan-out.
   *
   * Idempotently mirrors the 3 treasury-movement booleans into signed ledger
   * rows so balances stay consistent between the Crypto Treasury per-recharge
   * view and the per-wallet ledger.
   *
   * `step` is one of `okx` | `aed` | `wio`. `enabled=true` upserts the row
   * pair tagged with `external_ref = movement-<recharge_id>-step-<step>`.
   * `enabled=false` deletes both rows so toggling the step off auto-reverses.
   */
  async syncMovementStep(input: {
    step: 'okx' | 'aed' | 'wio';
    enabled: boolean;
    recharge_id: string;
    invoice_id?: string;
    source_wallet?: WalletCode;   // for 'okx': where USDT was pulled from
    coin?: string;
    amount?: string;
    rate?: string;                // for 'aed': USDT→AED rate
    aed_amount?: string;          // for 'aed' and 'wio'
    tx_hash?: string;
    bank_reference?: string;
    event_at?: Date;
    counterparty?: string;
    notes?: string;
  }, actor?: any) {
    const ref = `movement-${input.recharge_id}-step-${input.step}`;
    // Always remove previous pair first — keeps the function idempotent
    await this.ledger.createQueryBuilder().delete().from(WalletLedger)
      .where('external_ref = :ref', { ref }).execute();
    if (!input.enabled) return;
    const event_at = input.event_at || new Date();
    const writePair = async (rows: Partial<WalletLedger>[]) => {
      const out: WalletLedger[] = [];
      for (const row of rows) {
        out.push(await this.ledger.save(this.ledger.create({
          ...row,
          external_ref: ref,
          linked_recharge_id: input.recharge_id,
          linked_invoice_id: input.invoice_id,
          actor_email: actor?.email,
          event_at,
        })));
      }
      if (out.length === 2) {
        out[0].linked_ledger_id = out[1].id;
        out[1].linked_ledger_id = out[0].id;
        await this.ledger.save(out);
      }
    };
    if (input.step === 'okx') {
      const src = input.source_wallet || 'OXAPAY';
      const amt = parseFloat(input.amount || '0').toFixed(8);
      if (parseFloat(amt) <= 0) return;
      await writePair([
        {
          wallet: src, coin: (input.coin || 'USDT').toUpperCase(),
          amount: (-parseFloat(amt)).toFixed(8), tx_type: 'batch_out',
          tx_hash: input.tx_hash, counterparty: input.counterparty || 'OKX deposit',
          notes: input.notes || `Treasury sweep → OKX`,
        },
        {
          wallet: 'OKX', coin: (input.coin || 'USDT').toUpperCase(),
          amount: amt, tx_type: 'batch_in',
          tx_hash: input.tx_hash, counterparty: src,
          notes: input.notes || `Treasury sweep from ${src}`,
        },
      ]);
    } else if (input.step === 'aed') {
      const usdt = parseFloat(input.amount || '0').toFixed(8);
      const aed = parseFloat(input.aed_amount || '0').toFixed(2);
      if (parseFloat(usdt) <= 0 || parseFloat(aed) <= 0) return;
      await writePair([
        {
          wallet: 'OKX', coin: 'USDT',
          amount: (-parseFloat(usdt)).toFixed(8), tx_type: 'convert_from',
          rate_used: input.rate ? parseFloat(input.rate).toFixed(8) : null,
          counterparty: 'OKX FX desk',
          notes: input.notes || `Convert USDT → AED @ ${input.rate || '?'}`,
        },
        {
          wallet: 'OKX', coin: 'AED',
          amount: aed, tx_type: 'convert_to',
          rate_used: input.rate ? parseFloat(input.rate).toFixed(8) : null,
          aed_value_at_event: aed,
          counterparty: 'OKX FX desk',
          notes: input.notes || `Convert USDT → AED @ ${input.rate || '?'}`,
        },
      ]);
    } else if (input.step === 'wio') {
      const aed = parseFloat(input.aed_amount || '0').toFixed(2);
      if (parseFloat(aed) <= 0) return;
      await writePair([
        {
          wallet: 'OKX', coin: 'AED',
          amount: (-parseFloat(aed)).toFixed(2), tx_type: 'cashout',
          aed_value_at_event: aed,
          external_ref: ref, // overwritten anyway, but keep typesafe
          counterparty: input.bank_reference || 'Wio Bank',
          notes: input.notes || `Cashout to Wio (${input.bank_reference || 'ref'})`,
        },
        {
          wallet: 'WIO_BANK', coin: 'AED',
          amount: aed, tx_type: 'bank_deposit',
          aed_value_at_event: aed,
          counterparty: input.bank_reference || 'Wio Bank',
          notes: input.notes || `AED deposited from OKX (${input.bank_reference || 'ref'})`,
        },
      ]);
    }
  }

  /**
   * Drop every ledger row generated by the 3 treasury steps for this recharge.
   * Called when the recharge itself is deleted to keep balances clean.
   */
  async dropMovementLedger(recharge_id: string) {
    await this.ledger.createQueryBuilder().delete().from(WalletLedger)
      .where('external_ref IN (:...refs)', {
        refs: [
          `movement-${recharge_id}-step-okx`,
          `movement-${recharge_id}-step-aed`,
          `movement-${recharge_id}-step-wio`,
        ],
      }).execute();
  }

  async recordRechargeDeposit(input: {
    recharge_id: string;
    invoice_id?: string;
    payment_gateway: string;
    coin: string;
    network?: string;
    amount: string;
    tx_hash?: string;
    external_ref?: string;
    counterparty?: string;
    aed_value?: string;
    event_at?: Date;
    notes?: string;
    /** Explicit override of the ledger wallet (BINANCE/OKX/OXAPAY/BTCPAY). */
    received_wallet?: WalletCode;
    /** Free-text hint from webhook payloads (e.g. "binance-pay", "okx") */
    wallet_tag?: string;
    /** Original coin paid by customer when the gateway auto-converted (OxaPay) */
    original_coin?: string;
    /** Original amount in `original_coin` (before auto-conversion) */
    original_amount?: string;
  }, actor?: any) {
    const amt = parseFloat(input.amount || '0');
    if (!(amt > 0)) return null;
    // Avoid duplicating a ledger row for the same on-chain TX. The same
    // tx_hash can NEVER credit the wallet twice — even if (by admin error)
    // it gets associated with two recharges. Earlier the dedupe also required
    // `linked_recharge_id` to match, which allowed a 1065-sat-style drift
    // when the same hash slipped past two flows. Now we hard-block any
    // deposit row that already exists for this tx_hash.
    if (input.tx_hash) {
      const existing = await this.ledger.findOne({
        where: { tx_hash: input.tx_hash, tx_type: 'deposit' as any },
      });
      if (existing) return existing;
    }
    const wallet = input.received_wallet
      || this.pickWalletFromTag(input.wallet_tag)
      || this.pickWalletForGateway(input.payment_gateway, input.coin);
    return this.ledger.save(this.ledger.create({
      wallet, coin: (input.coin || 'USDT').toUpperCase(), network: input.network,
      amount: amt.toFixed(8), tx_type: 'deposit',
      original_coin: input.original_coin ? input.original_coin.toUpperCase() : null,
      original_amount: input.original_amount ? parseFloat(input.original_amount).toFixed(8) : null,
      linked_recharge_id: input.recharge_id, linked_invoice_id: input.invoice_id,
      tx_hash: input.tx_hash, external_ref: input.external_ref,
      counterparty: input.counterparty,
      aed_value_at_event: input.aed_value || null,
      notes: input.notes, actor_email: actor?.email,
      event_at: input.event_at || new Date(),
    }));
  }

  private pickWalletFromTag(tag?: string): WalletCode | null {
    const t = (tag || '').toLowerCase();
    if (!t) return null;
    if (t.includes('binance')) return 'BINANCE';
    if (t.includes('okx')) return 'OKX';
    if (t.includes('oxapay')) return 'OXAPAY';
    if (t.includes('btcpay')) return 'BTCPAY';
    if (t.includes('wio') || t.includes('bank')) return 'WIO_BANK';
    return null;
  }

  private pickWalletForGateway(payment_gateway: string, coin: string): WalletCode {
    const g = (payment_gateway || '').toLowerCase();
    if (g.includes('oxapay')) return 'OXAPAY';
    if (g.includes('btcpay')) return 'BTCPAY';
    if (g.includes('binance')) return 'BINANCE';
    if (g.includes('okx')) return 'OKX';
    if ((coin || '').toUpperCase() === 'BTC') return 'BTCPAY';
    if ((coin || '').toUpperCase() === 'USDT') return 'OXAPAY';
    // Default for manual payments (no MANUAL wallet anymore — exchanges only)
    return 'OKX';
  }
}
