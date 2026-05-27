import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { WalletLedger, WalletCode } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { AuditService } from '../audit/audit.service';

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

  async getOne(id: string) {
    const row = await this.ledger.findOne({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }

  // ----- Actions -----

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
  }, actor?: any) {
    if (input.from_coin === input.to_coin) throw new BadRequestException('Same coin');
    const fromAmt = parseFloat(input.from_amount);
    const rate = parseFloat(input.rate);
    const toAmt = input.to_amount ? parseFloat(input.to_amount) : fromAmt * rate;
    const conv_id = nextCode(`${input.wallet.slice(0, 3)}-CONV`);
    const fromCoin = input.from_coin.toUpperCase();
    const toCoin = input.to_coin.toUpperCase();

    const out = await this.ledger.save(this.ledger.create({
      wallet: input.wallet, coin: fromCoin, amount: (-fromAmt).toFixed(8),
      tx_type: 'convert_from', external_ref: conv_id,
      rate_used: rate.toString(), notes: input.notes,
      actor_email: actor?.email, event_at: new Date(),
    }));
    const inn = await this.ledger.save(this.ledger.create({
      wallet: input.wallet, coin: toCoin, amount: toAmt.toFixed(8),
      tx_type: 'convert_to', external_ref: conv_id,
      rate_used: rate.toString(), linked_ledger_id: out.id,
      notes: input.notes, actor_email: actor?.email, event_at: new Date(),
    }));
    out.linked_ledger_id = inn.id;
    await this.ledger.save(out);

    if (input.fee_amount && parseFloat(input.fee_amount) > 0) {
      await this.ledger.save(this.ledger.create({
        wallet: input.wallet, coin: (input.fee_currency || toCoin).toUpperCase(),
        amount: (-parseFloat(input.fee_amount)).toFixed(8), tx_type: 'fee',
        external_ref: conv_id, notes: 'Exchange/conversion fee',
        actor_email: actor?.email, event_at: new Date(),
      }));
    }

    if (input.ledger_ids?.length) {
      await this.ledger.createQueryBuilder().update(WalletLedger)
        .set({ linked_batch_id: conv_id })
        .whereInIds(input.ledger_ids).execute();
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_convert', entity_type: 'wallet_ledger', entity_id: out.id,
      details: `${input.wallet}: ${fromAmt} ${fromCoin} → ${toAmt.toFixed(2)} ${toCoin} @ ${rate} (${conv_id})`,
    });
    return { conv_id, out, in: inn };
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

    if (fee > 0) {
      await this.ledger.save(this.ledger.create({
        wallet: input.from_wallet, coin: 'AED', amount: (-fee).toFixed(2),
        tx_type: 'fee', external_ref: code, notes: 'Bank cashout fee',
        actor_email: actor?.email, event_at: new Date(),
      }));
    }

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'wallet_cashout', entity_type: 'wallet_ledger', entity_id: out.id,
      details: `${input.from_wallet} → Wio: ${aed} AED (fee ${fee}), ref ${input.bank_reference}`,
    });
    return { code, out, in: inn };
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
  }, actor?: any) {
    const amt = parseFloat(input.amount || '0');
    if (!(amt > 0)) return null;
    // Avoid duplicating ledger row for the same tx_hash on the same recharge
    if (input.tx_hash) {
      const existing = await this.ledger.findOne({
        where: { tx_hash: input.tx_hash, linked_recharge_id: input.recharge_id, tx_type: 'deposit' as any },
      });
      if (existing) return existing;
    }
    const wallet = input.received_wallet
      || this.pickWalletFromTag(input.wallet_tag)
      || this.pickWalletForGateway(input.payment_gateway, input.coin);
    return this.ledger.save(this.ledger.create({
      wallet, coin: (input.coin || 'USDT').toUpperCase(), network: input.network,
      amount: amt.toFixed(8), tx_type: 'deposit',
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
