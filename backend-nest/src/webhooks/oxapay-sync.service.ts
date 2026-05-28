import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { CryptoTransaction } from '../entities/crypto-transaction.entity';

/**
 * Pulls OxaPay's inbound payment history every 30 minutes and back-fills
 * `original_coin` / `original_amount` (and `final_usdt_amount`) on any wallet
 * ledger row + crypto_transaction that the webhook landed BEFORE we started
 * capturing the auto-conversion data.
 *
 * Uses BOTH merchant keys (portal + bot) and matches rows by tx_hash, then by
 * track_id, then by gateway_invoice_id — whichever the OxaPay payload exposes.
 * Safe to run anywhere: any row already populated is left alone.
 */
@Injectable()
export class OxaPaySyncService {
  private readonly log = new Logger('OxaPaySync');

  constructor(
    @InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>,
    @InjectRepository(Recharge) private recharges: Repository<Recharge>,
    @InjectRepository(CryptoTransaction) private cryptos: Repository<CryptoTransaction>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'oxapay-history-sync' })
  async runScheduled() {
    try {
      const summary = await this.sync({ silent: true });
      if (summary.matched > 0) this.log.log(`OxaPay sync — touched ${summary.matched} rows across ${summary.scanned} payments.`);
    } catch (e: any) {
      this.log.warn(`OxaPay sync failed: ${e.message}`);
    }
  }

  /**
   * Manual trigger. Returns `{ scanned, matched, errors, by_key }`.
   * Admin can hit POST /api/webhooks/oxapay/sync-history to fire this on demand.
   */
  async sync(opts?: { silent?: boolean }): Promise<{
    scanned: number; matched: number; errors: number;
    by_key: Array<{ key_label: string; count: number; error?: string }>;
  }> {
    const out = { scanned: 0, matched: 0, errors: 0, by_key: [] as any[] };
    const keys = [
      { label: 'portal', value: process.env.OXAPAY_PORTAL_MERCHANT_KEY },
      { label: 'calls-bot', value: process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY },
      { label: 'fallback', value: process.env.OXAPAY_MERCHANT_KEY },
    ].filter((k) => k.value && (k.label !== 'fallback' || (!process.env.OXAPAY_PORTAL_MERCHANT_KEY && !process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY)));

    if (keys.length === 0) {
      if (!opts?.silent) this.log.warn('No OXAPAY_*_MERCHANT_KEY configured — skipping sync.');
      return out;
    }

    for (const k of keys) {
      try {
        const rows = await this.fetchInbound(k.value!);
        out.by_key.push({ key_label: k.label, count: rows.length });
        out.scanned += rows.length;
        for (const row of rows) {
          if (await this.applyToRow(row)) out.matched += 1;
        }
      } catch (e: any) {
        out.errors += 1;
        out.by_key.push({ key_label: k.label, count: 0, error: e.message });
        if (!opts?.silent) this.log.warn(`OxaPay list (${k.label}) failed: ${e.message}`);
      }
    }
    return out;
  }

  /** Calls OxaPay's inbound payment list with a single merchant key. */
  private async fetchInbound(merchantKey: string): Promise<any[]> {
    const base = (process.env.OXAPAY_API_BASE || 'https://api.oxapay.com/v1').replace(/\/$/, '');
    // OxaPay's documented "list paid payments" endpoint. We try the modern
    // /payment/list endpoint first, then fall back to /payment with no track_id
    // which historically returned the most recent items.
    const candidates = [`${base}/payment/list`, `${base}/payment`];
    for (const url of candidates) {
      const u = new URL(url);
      u.searchParams.set('size', '50');
      u.searchParams.set('type', 'Payment');
      const res = await fetch(u.toString(), { headers: { merchant_api_key: merchantKey } });
      if (!res.ok) continue;
      const body: any = await res.json();
      const rows = body?.data?.list || body?.data?.rows || body?.list || body?.rows || body?.data;
      if (Array.isArray(rows)) return rows;
    }
    return [];
  }

  /** Updates a recharge + ledger row when the OxaPay row gives us new data. */
  private async applyToRow(row: any): Promise<boolean> {
    // Pull useful fields. Different OxaPay endpoints use different field names —
    // try them all, lowercase-safe.
    const txHash = row.tx_hash || row.txid || row.transactionId || row.transaction_id;
    const trackId = row.track_id || row.trackId || row.id;
    const payCurrency = row.payCurrency || row.pay_currency || row.original_coin;
    const payAmount = row.payAmount || row.pay_amount || row.original_amount;
    const finalUsdt = row.amount || row.received || row.received_amount || row.final_usdt_amount;
    if (!txHash && !trackId) return false;
    if (!payCurrency && !payAmount && !finalUsdt) return false; // nothing useful in this row

    // Find the ledger row (OxaPay deposit) by tx_hash; if missing, by external_ref.
    let ledgerRow: WalletLedger | null = null;
    if (txHash) {
      ledgerRow = await this.ledger.findOne({ where: { tx_hash: String(txHash), tx_type: 'deposit' as any } });
    }
    if (!ledgerRow && trackId) {
      // Try matching via the crypto_transactions table → linked_recharge_id
      const tx = await this.cryptos.findOne({ where: [{ gateway_track_id: String(trackId) }, { gateway_invoice_id: String(trackId) }] });
      if (tx) {
        ledgerRow = await this.ledger.findOne({
          where: { linked_recharge_id: tx.recharge_id, tx_type: 'deposit' as any },
          order: { event_at: 'DESC' },
        });
      }
    }
    if (!ledgerRow) return false;
    let changed = false;
    if (!ledgerRow.original_coin && payCurrency) {
      ledgerRow.original_coin = String(payCurrency).toUpperCase();
      ledgerRow.original_amount = parseFloat(String(payAmount)).toFixed(8);
      changed = true;
    }
    // When the wallet ledger still shows the customer-paid coin (BTC/ETH/etc.)
    // because the row was created BEFORE we started capturing auto-conversion,
    // swap the row over to the converted USDT now that we know the value.
    if (finalUsdt && (ledgerRow.coin || '').toUpperCase() !== 'USDT') {
      ledgerRow.amount = parseFloat(String(finalUsdt)).toFixed(8);
      ledgerRow.coin = 'USDT';
      changed = true;
    }
    if (!changed) return false;
    await this.ledger.save(ledgerRow);

    // Mirror onto the underlying crypto_transactions row so the Recharge
    // detail / audit chain shows the same "Final USDT" everywhere.
    if (txHash) {
      const tx = await this.cryptos.findOne({ where: { tx_hash: String(txHash) } });
      if (tx && finalUsdt && !tx.final_usdt_amount) {
        tx.final_usdt_amount = parseFloat(String(finalUsdt)).toFixed(8);
        if (!tx.received_amount && payAmount) tx.received_amount = parseFloat(String(payAmount)).toFixed(8);
        await this.cryptos.save(tx);
      }
    }
    return true;
  }
}
