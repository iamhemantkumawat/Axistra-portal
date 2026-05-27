import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { PageHeader, KpiCard, Modal, Field, Hash, Badge, EmptyState } from '../components/Atoms';
import { fmtDateTime, fmtNumber } from '../lib/format';
import {
  Wallet, Bank, Buildings, Coin, ArrowsLeftRight, ArrowSquareOut, Sparkle,
  PaperPlaneTilt, MagnifyingGlass, Receipt,
} from '@phosphor-icons/react';

const WALLET_ICONS = {
  OXAPAY:  { icon: Coin,       hint: 'OxaPay merchant balance',  type: 'crypto' },
  BTCPAY:  { icon: Coin,       hint: 'BTCPay store wallet',      type: 'crypto' },
  BINANCE: { icon: Buildings,  hint: 'Binance exchange wallet',  type: 'exchange' },
  OKX:     { icon: Buildings,  hint: 'OKX exchange wallet',      type: 'exchange' },
  WIO_BANK:{ icon: Bank,       hint: 'Wio AED settlement bank',  type: 'bank' },
  MANUAL:  { icon: Wallet,     hint: 'Manual / Card / Cash',     type: 'manual' },
};

const TX_TYPE_META = {
  deposit:      { label: 'Deposit',       cls: 'badge-success' },
  batch_out:    { label: 'Transfer Out',  cls: 'badge-warning' },
  batch_in:     { label: 'Transfer In',   cls: 'badge-info' },
  convert_from: { label: 'Convert From',  cls: 'badge-warning' },
  convert_to:   { label: 'Convert To',    cls: 'badge-info' },
  cashout:      { label: 'Cashout',       cls: 'badge-warning' },
  bank_deposit: { label: 'Bank Deposit',  cls: 'badge-success' },
  expense:      { label: 'Expense',       cls: 'badge-error' },
  fee:          { label: 'Fee',           cls: 'badge-neutral' },
  adjustment:   { label: 'Adjustment',    cls: 'badge-neutral' },
};

const fmtCrypto = (value, coin) => {
  const n = parseFloat(value || 0);
  if (!Number.isFinite(n)) return `0 ${coin || ''}`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${coin || ''}`.trim();
};

const initialBatchForm = (fromWallet) => ({
  from_wallet: fromWallet || 'OXAPAY',
  to_wallet: 'BINANCE',
  coin: 'USDT',
  network: 'TRC20',
  amount: '',
  fee_amount: '',
  received_amount: '',
  tx_hash: '',
  notes: '',
});

const initialConvertForm = (wallet) => ({
  wallet: wallet || 'BINANCE',
  from_coin: 'BTC',
  to_coin: 'USDT',
  from_amount: '',
  rate: '',
  to_amount: '',
  fee_amount: '',
  fee_currency: 'USDT',
  notes: '',
});

const initialCashoutForm = (wallet) => ({
  from_wallet: wallet || 'BINANCE',
  amount_aed: '',
  bank_fee_aed: '75',
  bank_reference: '',
  bank_deposit_date: new Date().toISOString().slice(0, 10),
  notes: '',
});

export default function WalletLedger() {
  const [overview, setOverview] = useState([]);
  const [active, setActive] = useState('OXAPAY');
  const [ledger, setLedger] = useState({ rows: [], total: 0 });
  const [coinFilter, setCoinFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState(initialBatchForm('OXAPAY'));
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState(initialConvertForm('BINANCE'));
  const [cashoutOpen, setCashoutOpen] = useState(false);
  const [cashoutForm, setCashoutForm] = useState(initialCashoutForm('BINANCE'));
  const [loading, setLoading] = useState(false);

  const loadOverview = async () => {
    const { data } = await api.get('/wallets/overview');
    setOverview(data);
  };

  const loadLedger = async (wallet = active) => {
    const params = new URLSearchParams();
    if (coinFilter) params.set('coin', coinFilter);
    if (typeFilter) params.set('tx_type', typeFilter);
    if (search) params.set('search', search);
    params.set('limit', '200');
    const { data } = await api.get(`/wallets/${wallet}/ledger?${params.toString()}`);
    setLedger(data);
  };

  useEffect(() => { loadOverview(); }, []);
  useEffect(() => { loadLedger(active); /* eslint-disable-next-line */ }, [active, coinFilter, typeFilter]);

  const totals = useMemo(() => {
    const t = { walletsCount: overview.length, totalAed: 0, totalUsdt: 0, txCount: 0 };
    overview.forEach((w) => w.balances.forEach((b) => {
      t.txCount += b.tx_count;
      if (b.coin === 'AED') t.totalAed += b.balance;
      if (b.coin === 'USDT') t.totalUsdt += b.balance;
    }));
    return t;
  }, [overview]);

  const activeWallet = useMemo(() => overview.find((w) => w.code === active), [overview, active]);

  const openBatch = () => { setBatchForm(initialBatchForm(active)); setBatchOpen(true); };
  const openConvert = () => { setConvertForm(initialConvertForm(active)); setConvertOpen(true); };
  const openCashout = () => { setCashoutForm(initialCashoutForm(active)); setCashoutOpen(true); };

  const submitBatch = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/wallets/${batchForm.from_wallet}/send-batch`, batchForm);
      toast.success('Batch transfer recorded on ledger');
      setBatchOpen(false);
      await loadOverview();
      await loadLedger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record batch');
    } finally { setLoading(false); }
  };

  const submitConvert = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/wallets/${convertForm.wallet}/convert`, convertForm);
      toast.success('Conversion recorded');
      setConvertOpen(false);
      await loadOverview();
      await loadLedger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record conversion');
    } finally { setLoading(false); }
  };

  const submitCashout = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/wallets/${cashoutForm.from_wallet}/cashout`, cashoutForm);
      toast.success('Cashout to Wio recorded');
      setCashoutOpen(false);
      await loadOverview();
      await loadLedger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record cashout');
    } finally { setLoading(false); }
  };

  return (
    <div data-testid="wallet-ledger-page">
      <PageHeader
        eyebrow="Treasury"
        title="Wallet Ledger"
        subtitle="Double-entry ledger across OxaPay, BTCPay, Binance, OKX and Wio Bank. Every deposit, transfer, conversion, expense and bank settlement lands as a signed row here."
        actions={(
          <>
            <button data-testid="btn-send-batch" className="btn-primary" onClick={openBatch}><PaperPlaneTilt size={16} className="inline mr-1" /> Send Batch</button>
            <button data-testid="btn-convert" className="btn-secondary" onClick={openConvert}><ArrowsLeftRight size={16} className="inline mr-1" /> Convert</button>
            <button data-testid="btn-cashout" className="btn-secondary" onClick={openCashout}><Bank size={16} className="inline mr-1" /> Cashout to Wio</button>
          </>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Wallets Tracked" value={totals.walletsCount} icon={Wallet} testId="kpi-wallets" />
        <KpiCard label="Total USDT" value={fmtCrypto(totals.totalUsdt, 'USDT')} icon={Coin} testId="kpi-total-usdt" />
        <KpiCard label="Total AED (Wio)" value={`AED ${fmtNumber(totals.totalAed)}`} icon={Bank} accent testId="kpi-total-aed" />
        <KpiCard label="Ledger Rows" value={totals.txCount} icon={Receipt} testId="kpi-tx-count" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 mb-6">
        {overview.map((w) => {
          const meta = WALLET_ICONS[w.code] || { icon: Wallet };
          const Icon = meta.icon;
          const primary = w.balances[0];
          const isActive = active === w.code;
          return (
            <button
              key={w.code}
              data-testid={`wallet-card-${w.code}`}
              onClick={() => setActive(w.code)}
              className={`rounded-lg border p-4 text-left transition-all ${isActive ? 'border-axistra-green bg-[var(--axistra-green-light)]' : 'border-gray-200 hover:border-axistra-green/60 bg-white'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-axistra-green border border-axistra-green/20">
                  <Icon size={18} weight="duotone" />
                </div>
                <Badge className={meta.type === 'bank' ? 'badge-success' : meta.type === 'exchange' ? 'badge-info' : 'badge-neutral'}>{meta.type}</Badge>
              </div>
              <div className="mt-3 font-display text-base font-bold text-gray-900">{w.label}</div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">{w.code}</div>
              {primary ? (
                <div className="mt-3">
                  <div className="text-[11px] text-gray-500">Balance</div>
                  <div className="font-mono text-lg font-bold text-axistra-green">{fmtCrypto(primary.balance, primary.coin)}</div>
                  {w.balances.slice(1).map((b) => (
                    <div key={b.coin} className="font-mono text-xs text-gray-600">{fmtCrypto(b.balance, b.coin)}</div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-xs text-gray-400">No activity yet</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="card-axistra mb-4 p-4 flex flex-wrap items-center gap-3">
        <div className="font-display font-semibold text-gray-900">
          {activeWallet?.label || active} <span className="text-gray-400 font-normal">— ledger</span>
        </div>
        <div className="flex-1" />
        <div className="relative w-full md:w-auto md:flex-1 md:max-w-sm">
          <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="ledger-search"
            placeholder="Search hash, ref, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadLedger(); }}
            className="input-axistra pl-7 w-full"
          />
        </div>
        <select data-testid="ledger-coin-filter" value={coinFilter} onChange={(e) => setCoinFilter(e.target.value)} className="input-axistra w-32">
          <option value="">All coins</option>
          <option>USDT</option><option>BTC</option><option>ETH</option><option>AED</option>
        </select>
        <select data-testid="ledger-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-axistra w-40">
          <option value="">All types</option>
          {Object.entries(TX_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => loadLedger()} className="btn-secondary">Apply</button>
      </div>

      <div className="card-axistra overflow-x-auto" data-testid="ledger-table-wrap">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Coin</th>
              <th>Amount</th>
              <th>Counterparty</th>
              <th>Ref</th>
              <th>Tx Hash</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.length === 0 && (
              <tr><td colSpan="8"><EmptyState title="No ledger entries" hint="Send a batch, convert coins or run a cashout to populate this wallet's history." /></td></tr>
            )}
            {ledger.rows.map((row) => {
              const meta = TX_TYPE_META[row.tx_type] || { label: row.tx_type, cls: 'badge-neutral' };
              const amt = parseFloat(row.amount || '0');
              return (
                <tr key={row.id} data-testid={`ledger-row-${row.id}`}>
                  <td className="text-xs text-gray-600">{fmtDateTime(row.event_at || row.created_at)}</td>
                  <td><Badge className={meta.cls}>{meta.label}</Badge></td>
                  <td className="font-mono text-xs">{row.coin}{row.network ? <span className="text-gray-400"> · {row.network}</span> : null}</td>
                  <td className={`font-mono text-sm font-semibold ${amt < 0 ? 'text-red-700' : 'text-axistra-green'}`}>
                    {amt < 0 ? '' : '+'}{fmtCrypto(amt, row.coin)}
                  </td>
                  <td className="text-xs text-gray-700 max-w-[160px] truncate">{row.counterparty || '—'}</td>
                  <td className="font-mono text-xs">{row.external_ref || '—'}</td>
                  <td><Hash value={row.tx_hash} /></td>
                  <td className="text-xs text-gray-500 max-w-[260px] truncate">{row.notes || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Send batch modal */}
      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="Send Batch Transfer" size="lg" testId="modal-send-batch">
        <form onSubmit={submitBatch} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="From Wallet">
            <select className="input-axistra" value={batchForm.from_wallet} onChange={(e) => setBatchForm({ ...batchForm, from_wallet: e.target.value })}>
              {Object.keys(WALLET_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="To Wallet">
            <select data-testid="batch-to-wallet" className="input-axistra" value={batchForm.to_wallet} onChange={(e) => setBatchForm({ ...batchForm, to_wallet: e.target.value })}>
              {Object.keys(WALLET_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Coin"><input className="input-axistra" value={batchForm.coin} onChange={(e) => setBatchForm({ ...batchForm, coin: e.target.value })} required /></Field>
          <Field label="Network"><input className="input-axistra" value={batchForm.network} onChange={(e) => setBatchForm({ ...batchForm, network: e.target.value })} placeholder="TRC20 / BTC / ERC20" /></Field>
          <Field label="Amount Sent"><input data-testid="batch-amount" className="input-axistra font-mono" value={batchForm.amount} onChange={(e) => setBatchForm({ ...batchForm, amount: e.target.value })} required placeholder="e.g. 1500" /></Field>
          <Field label="Network Fee"><input className="input-axistra font-mono" value={batchForm.fee_amount} onChange={(e) => setBatchForm({ ...batchForm, fee_amount: e.target.value })} placeholder="0" /></Field>
          <Field label="Amount Received at Destination"><input className="input-axistra font-mono" value={batchForm.received_amount} onChange={(e) => setBatchForm({ ...batchForm, received_amount: e.target.value })} placeholder="If different from sent − fee" /></Field>
          <Field label="Tx Hash"><input className="input-axistra font-mono" value={batchForm.tx_hash} onChange={(e) => setBatchForm({ ...batchForm, tx_hash: e.target.value })} placeholder="Blockchain TXID" /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={batchForm.notes} onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setBatchOpen(false)} className="btn-secondary">Cancel</button>
            <button data-testid="batch-submit" type="submit" disabled={loading} className="btn-primary disabled:opacity-50">{loading ? 'Recording…' : 'Record Batch'}</button>
          </div>
        </form>
      </Modal>

      {/* Convert modal */}
      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title="Convert Coins Inside Wallet" size="lg" testId="modal-convert">
        <form onSubmit={submitConvert} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Wallet">
            <select className="input-axistra" value={convertForm.wallet} onChange={(e) => setConvertForm({ ...convertForm, wallet: e.target.value })}>
              {Object.keys(WALLET_ICONS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="From Coin"><input className="input-axistra" value={convertForm.from_coin} onChange={(e) => setConvertForm({ ...convertForm, from_coin: e.target.value })} required /></Field>
          <Field label="To Coin"><input className="input-axistra" value={convertForm.to_coin} onChange={(e) => setConvertForm({ ...convertForm, to_coin: e.target.value })} required /></Field>
          <Field label="Rate (1 from = X to)"><input className="input-axistra font-mono" value={convertForm.rate} onChange={(e) => setConvertForm({ ...convertForm, rate: e.target.value })} required placeholder="e.g. 65000 for BTC→USDT" /></Field>
          <Field label="From Amount"><input data-testid="convert-amount" className="input-axistra font-mono" value={convertForm.from_amount} onChange={(e) => setConvertForm({ ...convertForm, from_amount: e.target.value })} required /></Field>
          <Field label="To Amount (override)"><input className="input-axistra font-mono" value={convertForm.to_amount} onChange={(e) => setConvertForm({ ...convertForm, to_amount: e.target.value })} placeholder="Auto from rate" /></Field>
          <Field label="Fee Amount"><input className="input-axistra font-mono" value={convertForm.fee_amount} onChange={(e) => setConvertForm({ ...convertForm, fee_amount: e.target.value })} placeholder="0" /></Field>
          <Field label="Fee Currency"><input className="input-axistra" value={convertForm.fee_currency} onChange={(e) => setConvertForm({ ...convertForm, fee_currency: e.target.value })} /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={convertForm.notes} onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setConvertOpen(false)} className="btn-secondary">Cancel</button>
            <button data-testid="convert-submit" type="submit" disabled={loading} className="btn-primary disabled:opacity-50">{loading ? 'Recording…' : 'Record Conversion'}</button>
          </div>
        </form>
      </Modal>

      {/* Cashout modal */}
      <Modal open={cashoutOpen} onClose={() => setCashoutOpen(false)} title="Cashout to Wio Bank" size="lg" testId="modal-cashout">
        <form onSubmit={submitCashout} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="From Wallet">
            <select className="input-axistra" value={cashoutForm.from_wallet} onChange={(e) => setCashoutForm({ ...cashoutForm, from_wallet: e.target.value })}>
              <option value="OKX">OKX</option>
              <option value="BINANCE">BINANCE</option>
            </select>
          </Field>
          <Field label="AED Amount Sent"><input data-testid="cashout-amount" className="input-axistra font-mono" value={cashoutForm.amount_aed} onChange={(e) => setCashoutForm({ ...cashoutForm, amount_aed: e.target.value })} required /></Field>
          <Field label="Bank Fee (AED)"><input className="input-axistra font-mono" value={cashoutForm.bank_fee_aed} onChange={(e) => setCashoutForm({ ...cashoutForm, bank_fee_aed: e.target.value })} /></Field>
          <Field label="Deposit Date"><input type="date" className="input-axistra" value={cashoutForm.bank_deposit_date} onChange={(e) => setCashoutForm({ ...cashoutForm, bank_deposit_date: e.target.value })} required /></Field>
          <Field label="Wio Reference" span={2}><input data-testid="cashout-ref" className="input-axistra font-mono" value={cashoutForm.bank_reference} onChange={(e) => setCashoutForm({ ...cashoutForm, bank_reference: e.target.value })} required placeholder="Wio bank reference / receipt number" /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={cashoutForm.notes} onChange={(e) => setCashoutForm({ ...cashoutForm, notes: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setCashoutOpen(false)} className="btn-secondary">Cancel</button>
            <button data-testid="cashout-submit" type="submit" disabled={loading} className="btn-primary disabled:opacity-50">{loading ? 'Recording…' : 'Record Cashout'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
