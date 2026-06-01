/**
 * Treasury page — pure helpers extracted from Treasury.jsx.
 * No React, no state, no hooks. Stable utility surface so the main page
 * focuses on flow + UI composition.
 */
import { fmtMoney } from '../../lib/format';

export const BATCH_STATUS_META = {
  open: { label: 'Open', cls: 'badge-neutral' },
  ready_to_transfer: { label: 'Ready to Transfer', cls: 'badge-warning' },
  sent_to_exchange: { label: 'Transferred', cls: 'badge-info' },
  received_in_exchange: { label: 'Transferred / Received', cls: 'badge-info' },
  converted_to_usdt: { label: 'Converted to USDT', cls: 'badge-info' },
  converted_to_aed: { label: 'Converted to AED', cls: 'badge-info' },
  reconciled: { label: 'Fully Reconciled', cls: 'badge-success' },
};

export const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
export const statusMeta = (status) => BATCH_STATUS_META[status] || { label: status || 'Open', cls: 'badge-neutral' };

export const fmtCrypto = (value) => {
  const n = parseFloat(value || '0');
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

export const fmtLedgerAmount = (value, currency) => {
  const normalized = String(currency || '').toUpperCase();
  if (['AED', 'USD', 'EUR', 'INR'].includes(normalized)) return fmtMoney(value, normalized);
  return `${fmtCrypto(value)} ${currency || ''}`.trim();
};

export const txFinalUsdt = (tx) => parseFloat(
  tx.final_usdt_amount || ((tx.coin || '').toUpperCase() === 'USDT' ? tx.received_amount || tx.crypto_amount || '0' : '0'),
) || 0;

export const rechargeFinalUsdt = (recharge) =>
  (recharge.crypto_transactions || []).reduce((sum, tx) => sum + txFinalUsdt(tx), 0);

export const rechargeCryptoLabel = (recharge) => {
  const txs = recharge.crypto_transactions || [];
  if (txs.length === 1) return `${fmtCrypto(txs[0].crypto_amount || txs[0].received_amount)} ${txs[0].coin || recharge.crypto_coin}`;
  return `${fmtCrypto(recharge.crypto_amount)} ${recharge.crypto_coin}`;
};

export const batchCryptoAmount = (batch) => parseFloat(batch.received_crypto_amount || batch.total_crypto_amount || '0') || 0;
export const batchUsdtAmount = (batch) => parseFloat(batch.usdt_amount || batch.crypto_converted || '0') || 0;
export const batchAedAmount = (batch) => parseFloat(batch.fiat_received || '0') || 0;

export const numeric = (value) => {
  const n = parseFloat(value || '0');
  return Number.isFinite(n) ? n : 0;
};

export const receiptCryptoAmount = (receipt) => numeric(receipt.crypto_amount);
export const entryCoin = (entry) => String(entry.crypto_coin || entry.coin || entry.currency || '').toUpperCase();

export const safeJson = (value) => {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return {}; }
};

export const isReadyReceipt = (r) => (
  !r.treasury?.treasury_batch_id
  && r.tx_hash
  && r.magnus_credited_at
  && !r.reconciled
  && !['mismatch', 'refunded', 'failed'].includes(r.status)
);

export const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const inDateRange = (value, filter, customFrom, customTo) => {
  if (!filter || filter === 'all') return true;
  const stamp = value ? new Date(value) : null;
  if (!stamp || Number.isNaN(stamp.getTime())) return false;
  const today = startOfDay(new Date());
  const rowDay = startOfDay(stamp);
  if (filter === 'today') return rowDay.getTime() === today.getTime();
  if (filter === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return rowDay.getTime() === yesterday.getTime();
  }
  if (filter === 'custom') {
    const from = customFrom ? startOfDay(new Date(customFrom)) : null;
    const to = customTo ? startOfDay(new Date(customTo)) : null;
    if (from && rowDay < from) return false;
    if (to && rowDay > to) return false;
  }
  return true;
};

export const rowCoin = (row) => String(row.crypto_coin || row.coin || row.currency || '').toUpperCase();

export function cleanPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== '' && value !== null && value !== undefined));
}

export const emptyBatchTemplate = () => ({
  name: `Treasury Sweep ${new Date().toISOString().slice(0, 10)}`,
  source_gateway: 'Mixed',
  source_wallet: '',
  destination_exchange: 'OKX',
  destination_wallet: '',
  coin: '',
  network: '',
  period_start: new Date().toISOString().slice(0, 10),
  period_end: new Date().toISOString().slice(0, 10),
  settlement_tx_hash: '',
  transfer_fee_crypto: '',
  received_crypto_amount: '',
  notes: '',
});
