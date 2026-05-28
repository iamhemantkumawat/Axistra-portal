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
    db_backfilled: number;
  }> {
    const out = { scanned: 0, matched: 0, errors: 0, by_key: [] as any[], db_backfilled: 0 };

    // 1) PRIMARY back-fill path — webhooks already saved the converted-USDT
    //    amount on `crypto_transactions.final_usdt_amount`. Mirror it onto the
    //    matching OXAPAY wallet_ledger rows. This is the same data source the
    //    Crypto Treasury "OxaPay" tab uses (Auto convert: X USDT) so the two
    //    views will always agree after a sync.
    out.db_backfilled = await this.backfillFromCryptoTx();
    out.matched += out.db_backfilled;

    // 2) Secondary path — try the OxaPay payment-list API as well in case any
    //    rows have no matching crypto_transaction row (e.g. manual entries).
    const keys = [
      { label: 'portal', value: process.env.OXAPAY_PORTAL_MERCHANT_KEY },
      { label: 'calls-bot', value: process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY },
      { label: 'fallback', value: process.env.OXAPAY_MERCHANT_KEY },
    ].filter((k) => k.value && (k.label !== 'fallback' || (!process.env.OXAPAY_PORTAL_MERCHANT_KEY && !process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY)));

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

  /**
   * Walk every OXAPAY ledger row whose coin isn't USDT, look up the matching
   * `crypto_transaction` (by tx_hash, then by linked_recharge_id), and if we
   * have a `final_usdt_amount` there, convert the ledger row over. Returns
   * how many rows we touched.
   */
  private async backfillFromCryptoTx(): Promise<number> {
    const rows = await this.ledger.find({
      where: { wallet: 'OXAPAY' as any, tx_type: 'deposit' as any },
    });
    let touched = 0;
    for (const row of rows) {
      // Skip rows where coin already shows the final USDT AND the original is
      // recorded — nothing to do.
      if ((row.coin || '').toUpperCase() === 'USDT' && row.original_coin) continue;

      let tx = row.tx_hash ? await this.cryptos.findOne({ where: { tx_hash: row.tx_hash } }) : null;
      if (!tx && row.linked_recharge_id) {
        // fall back to whichever crypto_transaction belongs to this recharge
        tx = await this.cryptos.findOne({ where: { recharge_id: row.linked_recharge_id } });
      }
      if (!tx) continue;

      const finalUsdt = parseFloat(String(tx.final_usdt_amount || '0'));
      const origAmt = tx.received_amount || tx.crypto_amount;
      const origCoin = (tx.coin || '').toUpperCase();
      let changed = false;

      // Case A: customer paid in non-USDT and OxaPay auto-converted.
      //   ledger row should become coin=USDT, amount=final_usdt_amount,
      //   original_*=what customer actually paid.
      if (finalUsdt > 0 && origCoin !== 'USDT') {
        if ((row.coin || '').toUpperCase() !== 'USDT' || parseFloat(row.amount) !== finalUsdt) {
          row.coin = 'USDT';
          row.amount = finalUsdt.toFixed(8);
          changed = true;
        }
        if (!row.original_coin) { row.original_coin = origCoin; row.original_amount = parseFloat(String(origAmt || '0')).toFixed(8); changed = true; }
      }
      // Case B: USDT-native payment. The row already shows USDT; nothing to flip
      //   but we can mark the row by setting original_coin = USDT so the UI
      //   stops showing "pending sync" (it's already final).
      else if (origCoin === 'USDT' && !row.original_coin) {
        row.original_coin = 'USDT';
        row.original_amount = parseFloat(String(origAmt || row.amount || '0')).toFixed(8);
        changed = true;
      }

      if (changed) {
        await this.ledger.save(row);
        touched += 1;
      }
    }
    return touched;
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
