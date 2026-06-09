import React, { useMemo, useState } from 'react';
import { Modal, Field } from '../Atoms';
import { toast } from 'sonner';
import { Plus, Trash, ArrowsSplit } from '@phosphor-icons/react';
import api from '../../lib/api';

const COINS = ['BTC', 'USDT', 'ETH', 'USDC', 'BNB', 'TRX'];
const NETWORKS = ['BTC', 'TRC20', 'ERC20', 'BEP20', 'Polygon', 'Solana'];
const GATEWAYS = ['Binance', 'OKX', 'OxaPay', 'BTCPay'];

const emptySplit = () => ({ magnus_username: '', amount: '', currency: 'EUR' });

/**
 * Modal for recording a single on-chain TX that was split between
 * multiple Magnus accounts. Submits to POST /api/recharges/split.
 *
 * Crypto shares are auto-derived as `total_crypto / N` unless the user
 * picks "Custom shares" and enters per-row amounts.
 */
export function SplitRechargeModal({ open, onClose, customers, onSuccess }) {
  const [tx, setTx] = useState({
    tx_hash: '',
    total_crypto_amount: '',
    crypto_coin: 'BTC',
    crypto_network: 'BTC',
    wallet_address: '',
    payment_gateway: 'Binance',
    payment_date: new Date().toISOString().slice(0, 10),
    admin_notes: '',
  });
  const [splits, setSplits] = useState([emptySplit(), emptySplit()]);
  const [customShares, setCustomShares] = useState(false);
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setTx({ tx_hash: '', total_crypto_amount: '', crypto_coin: 'BTC', crypto_network: 'BTC', wallet_address: '', payment_gateway: 'Binance', payment_date: new Date().toISOString().slice(0, 10), admin_notes: '' });
    setSplits([emptySplit(), emptySplit()]);
    setCustomShares(false);
  };
  const handleClose = () => { resetForm(); onClose(); };

  const updateSplit = (idx, patch) => {
    setSplits((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const addSplit = () => setSplits((prev) => [...prev, emptySplit()]);
  const removeSplit = (idx) => setSplits((prev) => prev.filter((_, i) => i !== idx));

  const totalCrypto = parseFloat(tx.total_crypto_amount || '0') || 0;
  const equalShare = splits.length > 0 ? totalCrypto / splits.length : 0;
  const sumShares = splits.reduce((s, r) => s + (parseFloat(r.crypto_share || '0') || 0), 0);
  const sumFiat = splits.reduce((s, r) => s + (parseFloat(r.amount || '0') || 0), 0);

  const previewShares = useMemo(() => splits.map((s) => ({
    ...s,
    _share_preview: customShares
      ? (parseFloat(s.crypto_share || '0') || 0).toFixed(8)
      : equalShare.toFixed(8),
  })), [splits, customShares, equalShare]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!tx.tx_hash.trim()) { toast.error('TX hash is required'); return; }
    if (totalCrypto <= 0) { toast.error('Total crypto amount must be > 0'); return; }
    if (splits.length < 2) { toast.error('A split needs at least 2 customers'); return; }
    for (const s of splits) {
      if (!s.magnus_username && !s.customer_id) { toast.error('Every split row needs a customer'); return; }
      if (!s.amount || parseFloat(s.amount) <= 0) { toast.error('Every split row needs a fiat amount > 0'); return; }
    }
    if (customShares && Math.abs(sumShares - totalCrypto) > 1e-7) {
      toast.error(`Sum of shares (${sumShares.toFixed(8)}) does not match total (${totalCrypto.toFixed(8)})`);
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...tx,
        splits: splits.map((s) => ({
          customer_id: s.customer_id || undefined,
          magnus_username: s.magnus_username || undefined,
          amount: s.amount,
          currency: s.currency,
          crypto_share: customShares ? s.crypto_share : undefined,
        })),
      };
      const { data } = await api.post('/recharges/split', payload);
      const codes = (data.siblings || []).map((s) => s.recharge_code).join(', ');
      toast.success(data.idempotent
        ? `Split already exists (group ${data.group_id?.slice(0, 8)}…): ${codes}`
        : `Split recharge created: ${codes}`);
      onSuccess?.();
      handleClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Split create failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Record Split Recharge" testId="split-recharge-modal" size="xl">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 mb-4">
        <div className="font-semibold mb-1 flex items-center gap-1.5"><ArrowsSplit size={14} weight="bold" /> When to use this</div>
        Use this when ONE BTC transaction arrives at your address but is shared between 2+ Magnus accounts (e.g. a €300 EUR payment split half-half to two customers). Each customer gets their own recharge + invoice, but the wallet ledger sees the deposit only ONCE.
      </div>
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Block 1: shared TX details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="TX Hash *" span={2}>
            <input required className="input-axistra font-mono text-xs" value={tx.tx_hash} onChange={(e) => setTx({ ...tx, tx_hash: e.target.value })} placeholder="8f1bbf9f3d42b41331f974976d28bf4d555b6cc4b1f7af074e05330a9b6a3c42" data-testid="split-tx-hash" />
          </Field>
          <Field label="Total Crypto Received *">
            <input required type="number" step="0.00000001" className="input-axistra font-mono" value={tx.total_crypto_amount} onChange={(e) => setTx({ ...tx, total_crypto_amount: e.target.value })} placeholder="0.00365791" data-testid="split-total-crypto" />
          </Field>
          <Field label="Coin">
            <select className="input-axistra" value={tx.crypto_coin} onChange={(e) => setTx({ ...tx, crypto_coin: e.target.value })}>
              {COINS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Network">
            <select className="input-axistra" value={tx.crypto_network} onChange={(e) => setTx({ ...tx, crypto_network: e.target.value })}>
              {NETWORKS.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Gateway">
            <select className="input-axistra" value={tx.payment_gateway} onChange={(e) => setTx({ ...tx, payment_gateway: e.target.value })}>
              {GATEWAYS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Receiving Address" span={2}>
            <input className="input-axistra font-mono text-xs" value={tx.wallet_address} onChange={(e) => setTx({ ...tx, wallet_address: e.target.value })} placeholder="15LZ1SSYZN2DBjrSuAdJ6uG4UW3u3pqUjw" />
          </Field>
          <Field label="Payment Date">
            <input type="date" className="input-axistra" value={tx.payment_date} onChange={(e) => setTx({ ...tx, payment_date: e.target.value })} />
          </Field>
          <Field label="Notes">
            <input className="input-axistra" value={tx.admin_notes} onChange={(e) => setTx({ ...tx, admin_notes: e.target.value })} placeholder="e.g. Telegram BTC Split 1/2" />
          </Field>
        </div>

        {/* Block 2: per-customer splits */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-sm">Splits ({splits.length})</div>
              <div className="text-xs text-gray-500">Each row creates one recharge + invoice. Equal shares are auto-derived.</div>
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={customShares} onChange={(e) => setCustomShares(e.target.checked)} data-testid="split-custom-shares" />
              <span>Custom crypto shares (manually enter each)</span>
            </label>
          </div>

          <div className="space-y-2">
            {previewShares.map((s, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end p-2 rounded-md border border-gray-100" data-testid={`split-row-${idx}`}>
                <div className="md:col-span-4">
                  <label className="label-xs">Customer (Magnus username)</label>
                  <input list="customers-list" className="input-axistra text-sm" value={s.magnus_username} onChange={(e) => updateSplit(idx, { magnus_username: e.target.value, customer_id: '' })} placeholder="e.g. Martello" data-testid={`split-row-${idx}-magnus`} />
                </div>
                <div className="md:col-span-2">
                  <label className="label-xs">Amount</label>
                  <input type="number" step="0.01" required className="input-axistra text-sm font-mono" value={s.amount} onChange={(e) => updateSplit(idx, { amount: e.target.value })} data-testid={`split-row-${idx}-amount`} />
                </div>
                <div className="md:col-span-2">
                  <label className="label-xs">Currency</label>
                  <select className="input-axistra text-sm" value={s.currency} onChange={(e) => updateSplit(idx, { currency: e.target.value })}>
                    <option>EUR</option><option>USD</option><option>AED</option><option>INR</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="label-xs">Crypto Share</label>
                  {customShares
                    ? <input type="number" step="0.00000001" className="input-axistra text-sm font-mono" value={s.crypto_share || ''} onChange={(e) => updateSplit(idx, { crypto_share: e.target.value })} data-testid={`split-row-${idx}-share`} />
                    : <div className="px-2 py-2 bg-gray-50 rounded text-xs font-mono text-gray-700">{s._share_preview}</div>}
                </div>
                <div className="md:col-span-1 flex justify-end">
                  {splits.length > 2 && (
                    <button type="button" onClick={() => removeSplit(idx)} className="text-red-500 hover:text-red-700 p-2" data-testid={`split-row-${idx}-remove`}>
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addSplit} className="mt-3 text-xs text-axistra-green hover:underline inline-flex items-center gap-1" data-testid="split-add-row">
            <Plus size={12} /> Add another split
          </button>

          {/* Summary */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <SumChip label="Total fiat" value={sumFiat.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
            <SumChip label="Sum of crypto shares" value={(customShares ? sumShares : (equalShare * splits.length)).toFixed(8)} />
            <SumChip label="On-chain total" value={totalCrypto.toFixed(8)} />
            <SumChip label="Diff" value={(totalCrypto - (customShares ? sumShares : equalShare * splits.length)).toFixed(8)} accent={Math.abs(totalCrypto - (customShares ? sumShares : equalShare * splits.length)) < 1e-7} />
          </div>
        </div>

        <datalist id="customers-list">
          {customers.map((c) => <option key={c.id} value={c.magnus_username || ''}>{c.customer_code} — {c.full_name}</option>)}
        </datalist>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary" data-testid="split-submit">
            {loading ? 'Creating…' : `Create ${splits.length}-way split`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SumChip({ label, value, accent }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accent ? 'bg-emerald-50 border-emerald-200' : 'border-gray-200'}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`font-mono text-xs ${accent ? 'text-emerald-700 font-semibold' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
