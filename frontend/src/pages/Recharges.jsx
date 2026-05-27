import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge, Modal, Field, Hash } from '../components/Atoms';
import { RECHARGE_STATUS_META, fmtDate } from '../lib/format';
import { useCurrency } from '../lib/currency';
import { Plus, MagnifyingGlass, Info } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';

const GATEWAYS = ['Binance', 'OKX', 'OxaPay', 'BTCPay'];
const COINS = ['BTC', 'USDT', 'ETH', 'USDC', 'BNB', 'TRX'];
const NETWORKS = ['BTC', 'TRC20', 'ERC20', 'BEP20', 'Polygon', 'Solana', 'OFF_CHAIN'];

const emptyForm = {
  customer_id: '',
  amount: '',
  currency: 'USD',
  payment_gateway: 'Binance',
  crypto_coin: 'BTC',
  crypto_network: 'BTC',
  wallet_address: '',
  tx_hash: '',
  admin_notes: '',
};

export default function Recharges() {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [receivingWallets, setReceivingWallets] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const { format } = useCurrency();
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const load = () => {
    const p = {};
    if (search) p.search = search;
    if (status) p.status = status;
    api.get('/recharges', { params: p }).then((r) => setItems(r.data));
  };

  useEffect(() => {
    load();
    api.get('/customers').then((r) => setCustomers(r.data));
    api.get('/settings/receiving-wallets').then((r) => setReceivingWallets(r.data));
  /* eslint-disable-next-line */ }, [status]);

  // Auto-detect: when gateway + coin + network are picked, pre-fill the matching saved wallet address.
  const matchedWallet = useMemo(() => {
    return receivingWallets.find(
      (w) =>
        w.is_active &&
        w.gateway === form.payment_gateway &&
        w.coin === form.crypto_coin &&
        w.network === form.crypto_network,
    );
  }, [receivingWallets, form.payment_gateway, form.crypto_coin, form.crypto_network]);

  useEffect(() => {
    if (matchedWallet && !form.wallet_address) {
      setForm((f) => ({ ...f, wallet_address: matchedWallet.address }));
    }
  /* eslint-disable-next-line */ }, [matchedWallet]);

  const openNewModal = () => {
    setForm(emptyForm);
    setModalOpen(true);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/recharges', form);
      toast.success(`Recharge ${data.recharge_code} created`);
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const useMatched = () => {
    if (matchedWallet) setForm({ ...form, wallet_address: matchedWallet.address });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Payments"
        title="Recharges"
        subtitle="Every sale keeps its own customer payment TXID; later sweeps to OKX/Binance are linked through treasury batches."
        actions={
          <button onClick={openNewModal} className="btn-primary inline-flex items-center gap-2" data-testid="new-recharge-btn">
            <Plus size={16} /> New Recharge
          </button>
        }
      />

      <div className="card-axistra p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search by recharge code, TX hash, invoice, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="input-axistra pl-9"
            data-testid="recharge-search-input"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-axistra md:w-56" data-testid="recharge-status-filter">
          <option value="">All statuses</option>
          {Object.keys(RECHARGE_STATUS_META).map((k) => <option key={k} value={k}>{RECHARGE_STATUS_META[k].label}</option>)}
        </select>
        <button onClick={load} className="btn-secondary">Apply</button>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Code</th><th>Customer</th><th>Amount</th>
              <th>Gateway</th><th>Coin/Network</th><th>TX Hash</th>
              <th>Status</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="8" className="text-center text-gray-500 py-10">No recharges yet.</td></tr>}
            {items.map((r) => (
              <tr key={r.id} data-testid={`recharge-row-${r.recharge_code}`} onClick={() => nav(`/recharges/${r.id}`)} className="cursor-pointer">
                <td><Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.recharge_code}</Link></td>
                <td>
                  <div className="font-medium">{r.customer?.full_name || '—'}</div>
                  <div className="text-xs text-gray-500">{r.customer?.customer_code}</div>
                </td>
                <td className="font-mono font-semibold">{format(r.amount, r.currency)}</td>
                <td className="text-xs"><span className="badge badge-neutral">{r.payment_gateway || '—'}</span></td>
                <td className="text-xs">
                  <span className="font-mono">{r.crypto_amount} {r.crypto_coin}</span>
                  <span className="text-gray-500"> / {r.crypto_network}</span>
                </td>
                <td><Hash value={r.tx_hash} /></td>
                <td><Badge className={RECHARGE_STATUS_META[r.status]?.cls}>{RECHARGE_STATUS_META[r.status]?.label}</Badge></td>
                <td className="text-xs text-gray-500">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Recharge" testId="new-recharge-modal" size="lg">
        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer *" span={2}>
            <select required value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} className="input-axistra" data-testid="rch-form-customer">
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_code} — {c.full_name}</option>)}
            </select>
          </Field>

          <Field label="Amount *">
            <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input-axistra" data-testid="rch-form-amount" />
          </Field>
          <Field label="Currency *">
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="input-axistra" data-testid="rch-form-currency">
              <option>USD</option><option>EUR</option><option>AED</option>
            </select>
          </Field>

          {/* Gateway BEFORE coins — per UX update */}
          <Field label="Payment Gateway *">
            <select required value={form.payment_gateway} onChange={(e) => setForm({ ...form, payment_gateway: e.target.value, wallet_address: '' })} className="input-axistra" data-testid="rch-form-gateway">
              {GATEWAYS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Coin *">
            <select required value={form.crypto_coin} onChange={(e) => setForm({ ...form, crypto_coin: e.target.value, wallet_address: '' })} className="input-axistra" data-testid="rch-form-coin">
              {COINS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Network *">
            <select required value={form.crypto_network} onChange={(e) => setForm({ ...form, crypto_network: e.target.value, wallet_address: '' })} className="input-axistra" data-testid="rch-form-network">
              {NETWORKS.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <div className="md:col-span-2">
            {matchedWallet ? (
              <div className="rounded-md border border-axistra-green/30 bg-[var(--axistra-green-light)] p-3 text-sm flex items-start gap-2" data-testid="matched-wallet-hint">
                <Info size={16} className="text-axistra-green mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-axistra-green">Saved address found</div>
                  <div className="text-xs text-gray-600 mt-0.5">{matchedWallet.label || `${matchedWallet.gateway} ${matchedWallet.coin}/${matchedWallet.network}`}</div>
                  <div className="font-mono text-xs break-all mt-1">{matchedWallet.address}</div>
                  <button type="button" onClick={useMatched} className="text-xs underline text-axistra-green mt-1">Use this address</button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 flex items-start gap-2">
                <Info size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
                No saved wallet for <strong>{form.payment_gateway} · {form.crypto_coin}/{form.crypto_network}</strong>. Add it under Settings → Receiving Wallets to auto-detect future payments.
              </div>
            )}
          </div>
          <Field label="Wallet Address" span={2}>
            <input value={form.wallet_address} onChange={(e) => setForm({ ...form, wallet_address: e.target.value })} placeholder={matchedWallet ? matchedWallet.address : 'Receiving wallet address'} className="input-axistra font-mono text-sm" data-testid="rch-form-wallet" />
          </Field>
          <Field label={form.crypto_network === 'OFF_CHAIN' ? 'Internal TX ID' : 'TX Hash'} span={2}>
            <input value={form.tx_hash} onChange={(e) => setForm({ ...form, tx_hash: e.target.value })} placeholder={form.crypto_network === 'OFF_CHAIN' ? 'Binance internal txid' : 'On-chain transaction hash'} className="input-axistra font-mono text-sm" data-testid="rch-form-tx" />
          </Field>
          <Field label="Admin Notes" span={2}>
            <textarea rows={2} value={form.admin_notes} onChange={(e) => setForm({ ...form, admin_notes: e.target.value })} className="input-axistra" data-testid="rch-form-notes" />
          </Field>
          <div className="md:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="rch-form-submit">{loading ? 'Creating…' : 'Create Recharge'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
