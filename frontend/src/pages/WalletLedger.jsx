import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { PageHeader, KpiCard, Modal, Field, Hash, Badge, EmptyState } from '../components/Atoms';
import { fmtDateTime, fmtNumber } from '../lib/format';
import {
  Wallet, Bank, Buildings, Coin, ArrowsLeftRight, ArrowSquareOut, Sparkle,
  PaperPlaneTilt, MagnifyingGlass, Receipt, Trash,
} from '@phosphor-icons/react';

const WALLET_ICONS = {
  OXAPAY:  { icon: Coin,       hint: 'OxaPay merchant balance — auto-converted to USDT',  type: 'crypto',   coins: ['USDT'] },
  BTCPAY:  { icon: Coin,       hint: 'BTCPay store wallet — BTC only',                    type: 'crypto',   coins: ['BTC'] },
  BINANCE: { icon: Buildings,  hint: 'Binance exchange wallet — multi-coin + fiat',        type: 'exchange', coins: ['USDT', 'BTC', 'ETH', 'AED', 'USD', 'EUR', 'GBP'] },
  OKX:     { icon: Buildings,  hint: 'OKX exchange wallet — multi-coin + fiat',            type: 'exchange', coins: ['USDT', 'BTC', 'ETH', 'AED', 'USD', 'EUR', 'GBP'] },
  WIO_BANK:{ icon: Bank,       hint: 'Wio AED settlement bank',                           type: 'bank',     coins: ['AED'] },
};

/** Single-coin wallets can't host an in-wallet Convert (no second coin to swap to). */
const SUPPORTS_CONVERT = (code) => {
  const meta = WALLET_ICONS[code];
  return !!(meta && (meta.coins?.length || 0) > 1);
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
  event_at: new Date().toISOString().slice(0, 10),
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
  const [oxapaySyncing, setOxapaySyncing] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const openAudit = async () => {
    setAuditLoading(true);
    setAuditOpen(true);
    try {
      const { data } = await api.get(`/wallets/${active}/audit`);
      setAudit(data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Audit failed');
      setAuditOpen(false);
    } finally {
      setAuditLoading(false);
    }
  };

  const runOxaPaySync = async () => {
    setOxapaySyncing(true);
    try {
      const { data } = await api.post('/webhooks/oxapay/sync-history');
      const detail = (data.by_key || []).map((k) => `${k.key_label}: ${k.count}`).join(' · ');
      const filled = data.db_backfilled || 0;
      if (data.errors > 0) {
        toast.warning(`OxaPay sync had ${data.errors} error(s). Back-filled ${filled} row(s) from DB · scanned ${data.scanned} from API${detail ? ' · ' + detail : ''}`);
      } else {
        toast.success(`OxaPay sync OK — back-filled ${filled} row(s) from webhook data${detail ? ' · API list: ' + detail : ''}.`);
      }
      await loadLedger(active);
      await loadOverview();
    } catch (err) {
      toast.error(err.response?.data?.message || 'OxaPay sync failed');
    } finally {
      setOxapaySyncing(false);
    }
  };

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

  const deleteRow = async (row) => {
    const amt = parseFloat(row.amount || '0');
    if (!window.confirm(`Delete this ledger row?\n\n${row.tx_type} ${amt} ${row.coin} on ${active}\n\nIf this row was generated from a recharge / expense / treasury movement, deleting it here is a one-off cleanup — the source record will recreate it on its next save. The matching paired row (if any) is also removed to keep the double-entry balanced.`)) return;
    try {
      const res = await api.delete(`/wallets/ledger/${row.id}`);
      toast.success(res.data?.paired_deleted ? 'Ledger row + paired row deleted' : 'Ledger row deleted');
      await loadOverview();
      await loadLedger();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete row');
    }
  };

  useEffect(() => { loadOverview(); }, []);
  useEffect(() => { loadLedger(active); /* eslint-disable-next-line */ }, [active, coinFilter, typeFilter]);

  const totals = useMemo(() => {
    const t = { walletsCount: overview.length, totalAedWio: 0, totalAedAll: 0, totalUsdt: 0, txCount: 0 };
    overview.forEach((w) => w.balances.forEach((b) => {
      t.txCount += b.tx_count;
      if (b.coin === 'AED') {
        t.totalAedAll += b.balance;
        if (w.code === 'WIO_BANK') t.totalAedWio += b.balance;
      }
      if (b.coin === 'USDT') t.totalUsdt += b.balance;
    }));
    return t;
  }, [overview]);

  const activeWallet = useMemo(() => overview.find((w) => w.code === active), [overview, active]);

  const openBatch = () => { setBatchForm(initialBatchForm(active)); setBatchOpen(true); };
  const openConvert = () => {
    const wallet = SUPPORTS_CONVERT(active) ? active : 'BINANCE';
    const coins = WALLET_ICONS[wallet]?.coins || ['USDT'];
    const fromCoin = coins.find((c) => c !== 'USDT') || coins[0] || 'BTC';
    const toCoin = coins.find((c) => c !== fromCoin) || 'USDT';
    setConvertForm({
      ...initialConvertForm(wallet),
      from_coin: fromCoin,
      to_coin: toCoin,
      fee_currency: toCoin,
    });
    setConvertOpen(true);
  };
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
      const isExchange = ['BINANCE', 'OKX', 'AED_TREASURY'].includes(convertForm.wallet);
      if (isExchange) {
        // Routes through TreasuryService so a Treasury batch is auto-created
        // and any unbatched receipts on this exchange + coin are auto-assigned
        // to it — keeps the Customer → Invoice → TX → Batch audit chain.
        const { data } = await api.post('/treasury/exchange-convert', {
          wallet: convertForm.wallet,
          from_coin: convertForm.from_coin,
          to_coin: convertForm.to_coin,
          from_amount: convertForm.from_amount,
          to_amount: convertForm.to_amount,
          event_at: convertForm.event_at,
          notes: convertForm.notes,
        });
        toast.success(`Conversion recorded as ${data.batch?.batch_code || 'batch'} · ${data.assigned_recharges_count || 0} receipt(s) auto-assigned`);
      } else {
        await api.post(`/wallets/${convertForm.wallet}/convert`, convertForm);
        toast.success('Conversion recorded');
      }
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
            <button data-testid="btn-send-batch" className="btn-primary" onClick={openBatch}><PaperPlaneTilt size={16} className="inline mr-1" /> Transfer Crypto</button>
            {SUPPORTS_CONVERT(active) ? (
              <button data-testid="btn-convert" className="btn-secondary" onClick={openConvert}><ArrowsLeftRight size={16} className="inline mr-1" /> Convert Coin</button>
            ) : (
              <button title={`${active} only holds ${(WALLET_ICONS[active]?.coins || []).join(', ')} — convert on Binance/OKX after transferring there.`} data-testid="btn-convert-disabled" className="btn-secondary opacity-40 cursor-not-allowed" disabled>
                <ArrowsLeftRight size={16} className="inline mr-1" /> Convert Coin
              </button>
            )}
            <button data-testid="btn-cashout" className="btn-secondary" onClick={openCashout}><Bank size={16} className="inline mr-1" /> Withdraw AED to Wio</button>
          </>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Wallets Tracked" value={totals.walletsCount} icon={Wallet} testId="kpi-wallets" />
        <KpiCard label="Total USDT" value={fmtCrypto(totals.totalUsdt, 'USDT')} icon={Coin} testId="kpi-total-usdt" />
        <KpiCard
          label="AED on Wio Bank"
          value={`AED ${fmtNumber(totals.totalAedWio)}`}
          sub={Math.abs(totals.totalAedAll - totals.totalAedWio) > 0.01
            ? `+ AED ${fmtNumber(totals.totalAedAll - totals.totalAedWio)} on exchanges (pending cashout)`
            : 'No AED held on exchanges'}
          icon={Bank} accent testId="kpi-total-aed"
        />
        <KpiCard label="Ledger Rows" value={totals.txCount} icon={Receipt} testId="kpi-tx-count" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {overview.map((w) => {
          const meta = WALLET_ICONS[w.code] || { icon: Wallet, coins: [] };
          const Icon = meta.icon;
          const isActive = active === w.code;
          // Walk the wallet's allowed-coins list and surface a row per coin,
          // so empty balances (e.g. OKX AED) still show "0.00 AED" instead of
          // hiding the line.
          const allowed = meta.coins && meta.coins.length ? meta.coins : (w.balances || []).map((b) => b.coin);
          const lookup = Object.fromEntries((w.balances || []).map((b) => [b.coin, b.balance]));
          const showBalances = allowed.map((coin) => ({ coin, balance: lookup[coin] ?? 0 }));
          return (
            <button
              key={w.code}
              data-testid={`wallet-card-${w.code}`}
              onClick={() => setActive(w.code)}
              className={`group flex h-full min-h-[230px] flex-col rounded-lg border p-4 text-left transition-all ${isActive ? 'border-axistra-green bg-[var(--axistra-green-light)] shadow-sm' : 'border-gray-200 hover:border-axistra-green/60 hover:shadow-sm bg-white'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-axistra-green border border-axistra-green/20">
                  <Icon size={18} weight="duotone" />
                </div>
                <Badge className={meta.type === 'bank' ? 'badge-success' : meta.type === 'exchange' ? 'badge-info' : 'badge-neutral'}>{meta.type}</Badge>
              </div>
              <div className="mt-3 font-display text-base font-bold text-gray-900 truncate">{w.label}</div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">{w.code}</div>
              {showBalances.length ? (
                <div className="mt-3 space-y-0.5 flex-1">
                  {showBalances.map((b, idx) => (
                    <div key={b.coin} className={`font-mono ${idx === 0 ? 'text-base font-bold text-axistra-green' : 'text-xs ' + (b.balance < 0 ? 'text-red-600' : 'text-gray-600')}`}>
                      {fmtCrypto(b.balance, b.coin)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex-1 text-xs text-gray-400">No activity yet</div>
              )}
              {meta.hint && <div className="mt-2 text-[10px] text-gray-400 line-clamp-2">{meta.hint}</div>}
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
        <button
          onClick={openAudit}
          className="btn-secondary inline-flex items-center gap-1"
          data-testid="ledger-audit-btn"
          title="Reconcile ledger with on-chain wallet. Highlights duplicate tx_hashes and orphan deposits to find balance drift."
        >
          <MagnifyingGlass size={14} weight="bold" />
          Reconcile
        </button>
        {active === 'OXAPAY' && (
          <button
            data-testid="ledger-oxapay-sync-btn"
            onClick={runOxaPaySync}
            disabled={oxapaySyncing}
            title="Fetches the OxaPay payment history with both merchant keys (portal + calls-bot) and back-fills the Final USDT + customer-paid columns for any rows missing the conversion data."
            className="btn-primary inline-flex items-center gap-2"
          >
            <Sparkle size={14} weight="duotone" />
            {oxapaySyncing ? 'Syncing…' : 'Sync from OxaPay'}
          </button>
        )}
      </div>

      <div className="card-axistra overflow-x-auto" data-testid="ledger-table-wrap">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Coin</th>
              <th>Amount</th>
              {active === 'OXAPAY' && <th data-testid="ledger-th-final-usdt">Final USDT</th>}
              <th>Counterparty</th>
              <th>Ref</th>
              <th>Tx Hash</th>
              <th>Notes</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.length === 0 && (
              <tr><td colSpan={active === 'OXAPAY' ? 10 : 9}><EmptyState title="No ledger entries" hint="Send a batch, convert coins or run a cashout to populate this wallet's history." /></td></tr>
            )}
            {ledger.rows.map((row) => {
              const meta = TX_TYPE_META[row.tx_type] || { label: row.tx_type, cls: 'badge-neutral' };
              const amt = parseFloat(row.amount || '0');
              // For OxaPay deposits we want to surface what the CUSTOMER paid
              // (e.g. 0.00156404 BTC on Bitcoin Network) in the Coin/Amount
              // columns and keep the converted USDT amount in the dedicated
              // Final USDT column. Everywhere else we just show the row as-is.
              const isOxaDeposit = active === 'OXAPAY' && row.tx_type === 'deposit';
              const origCoin = row.original_coin && parseFloat(row.original_amount || '0') > 0
                ? String(row.original_coin).toUpperCase()
                : null;
              const origAmt = origCoin ? parseFloat(row.original_amount || '0') : null;
              const displayCoin = isOxaDeposit && origCoin ? origCoin : row.coin;
              const displayAmount = isOxaDeposit && origAmt != null ? (amt < 0 ? -origAmt : origAmt) : amt;
              return (
                <tr key={row.id} data-testid={`ledger-row-${row.id}`}>
                  <td className="text-xs text-gray-600">{fmtDateTime(row.event_at || row.created_at)}</td>
                  <td><Badge className={meta.cls}>{meta.label}</Badge></td>
                  <td className="font-mono text-xs">{displayCoin}{row.network ? <span className="text-gray-400"> · {row.network}</span> : null}</td>
                  <td className={`font-mono text-sm font-semibold ${displayAmount < 0 ? 'text-red-700' : 'text-axistra-green'}`}>
                    {displayAmount < 0 ? '' : '+'}{fmtCrypto(displayAmount, displayCoin)}
                  </td>
                  {active === 'OXAPAY' && (
                    <td className="font-mono text-xs" data-testid={`ledger-final-usdt-${row.id}`}>
                      {/* OxaPay auto-converts incoming coins to USDT. `row.amount`
                          is the converted USDT figure — show it here regardless
                          of what we displayed in the Coin/Amount columns. */}
                      {(row.coin || '').toUpperCase() === 'USDT' ? (
                        <span className="text-axistra-green font-semibold">{fmtCrypto(Math.abs(amt), 'USDT')}</span>
                      ) : (
                        <span className="text-gray-400">pending sync</span>
                      )}
                    </td>
                  )}
                  <td className="text-xs text-gray-700 max-w-[160px] truncate">{row.counterparty || '—'}</td>
                  <td className="font-mono text-xs">{row.external_ref || '—'}</td>
                  <td><Hash value={row.tx_hash} /></td>
                  <td className="text-xs text-gray-500 max-w-[260px] truncate">{row.notes || '—'}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => deleteRow(row)}
                      className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete this ledger row"
                      data-testid={`ledger-delete-${row.id}`}
                    >
                      <Trash size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Send batch modal */}
      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="Step 1 · Transfer Crypto Between Wallets" size="lg" testId="modal-send-batch">
        <div className="mb-3 rounded-md border border-axistra-green/30 bg-[var(--axistra-green-light)] p-3 text-xs text-gray-700">
          <strong className="text-axistra-green">Crypto-to-crypto only.</strong> Moves the same coin from one wallet to another (e.g. OxaPay → Binance, BTCPay → OKX). No conversion happens here — the coin stays as it is. Use Step 2 (Convert) to swap coins inside the exchange.
        </div>
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
      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title="Convert Coin Inside Wallet" size="lg" testId="modal-convert">
        <div className="mb-3 rounded-md border border-axistra-green/30 bg-[var(--axistra-green-light)] p-3 text-xs text-gray-700">
          <strong className="text-axistra-green">Same-wallet swap.</strong> Swaps one coin for another inside an exchange (e.g. BTC → USDT, USDT → AED). Funds stay inside the same wallet. Pick a coin you actually hold, enter what you received from the exchange — the rate is calculated for you.
        </div>
        {(() => {
          const convertableWallets = Object.keys(WALLET_ICONS).filter((k) => SUPPORTS_CONVERT(k));
          const walletMeta = WALLET_ICONS[convertForm.wallet] || { coins: ['USDT'] };
          const walletBalances = overview.find((w) => w.code === convertForm.wallet)?.balances || [];
          const balanceLookup = Object.fromEntries(walletBalances.map((b) => [b.coin, parseFloat(b.balance || '0')]));
          const availableFromCoins = walletMeta.coins || [];
          const availableToCoins = availableFromCoins.filter((c) => c !== convertForm.from_coin);
          const fromBalance = balanceLookup[convertForm.from_coin] || 0;
          const fromAmt = parseFloat(convertForm.from_amount || '0');
          const toAmt = parseFloat(convertForm.to_amount || '0');
          const liveRate = fromAmt > 0 && toAmt > 0 ? (toAmt / fromAmt) : 0;
          const overdraft = fromAmt > 0 && fromAmt > fromBalance;
          return (
            <form onSubmit={submitConvert} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Wallet">
                  <select
                    data-testid="convert-wallet"
                    className="input-axistra"
                    value={convertForm.wallet}
                    onChange={(e) => {
                      const w = e.target.value;
                      const coins = WALLET_ICONS[w]?.coins || [];
                      const fromCoin = coins.find((c) => c !== 'USDT') || coins[0] || 'BTC';
                      const toCoin = coins.find((c) => c !== fromCoin) || 'USDT';
                      setConvertForm({ ...convertForm, wallet: w, from_coin: fromCoin, to_coin: toCoin, fee_currency: toCoin });
                    }}
                  >
                    {convertableWallets.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="Conversion Date">
                  <input
                    type="date"
                    data-testid="convert-date"
                    className="input-axistra"
                    value={convertForm.event_at}
                    onChange={(e) => setConvertForm({ ...convertForm, event_at: e.target.value })}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="label-xs mb-1">From Coin</div>
                  <select
                    data-testid="convert-from-coin"
                    className="input-axistra"
                    value={convertForm.from_coin}
                    onChange={(e) => {
                      const fromCoin = e.target.value;
                      const toCoin = availableFromCoins.find((c) => c !== fromCoin) || 'USDT';
                      setConvertForm({ ...convertForm, from_coin: fromCoin, to_coin: convertForm.to_coin === fromCoin ? toCoin : convertForm.to_coin, fee_currency: convertForm.to_coin === fromCoin ? toCoin : convertForm.to_coin });
                    }}
                  >
                    {availableFromCoins.map((c) => (
                      <option key={c} value={c}>{c} · {fmtCrypto(balanceLookup[c] || 0, c)}</option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-gray-500">Available: <span className="font-mono">{fmtCrypto(fromBalance, convertForm.from_coin)}</span></div>
                </div>
                <div>
                  <div className="label-xs mb-1">From Amount</div>
                  <div className="relative">
                    <input
                      data-testid="convert-from-amount"
                      type="number"
                      step="0.00000001"
                      className={`input-axistra font-mono pr-16 ${overdraft ? 'border-red-400' : ''}`}
                      value={convertForm.from_amount}
                      onChange={(e) => setConvertForm({ ...convertForm, from_amount: e.target.value })}
                      placeholder={`How much ${convertForm.from_coin} you sold`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setConvertForm({ ...convertForm, from_amount: fromBalance > 0 ? String(fromBalance) : '0' })}
                      disabled={!(fromBalance > 0)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-axistra-green/10 px-2 py-0.5 text-[11px] font-semibold text-axistra-green hover:bg-axistra-green/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid="convert-from-max"
                      title={fromBalance > 0 ? 'Fill with available balance' : 'No positive balance to fill'}
                    >
                      MAX
                    </button>
                  </div>
                  {overdraft && <div className="mt-1 text-[11px] text-red-600">Amount exceeds the {convertForm.from_coin} balance available in this wallet.</div>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="To Coin">
                  <select
                    data-testid="convert-to-coin"
                    className="input-axistra"
                    value={convertForm.to_coin}
                    onChange={(e) => setConvertForm({ ...convertForm, to_coin: e.target.value, fee_currency: e.target.value })}
                  >
                    {availableToCoins.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Received Amount">
                  <input
                    data-testid="convert-to-amount"
                    type="number"
                    step="0.00000001"
                    className="input-axistra font-mono"
                    value={convertForm.to_amount}
                    onChange={(e) => setConvertForm({ ...convertForm, to_amount: e.target.value })}
                    placeholder={`How much ${convertForm.to_coin} the exchange gave you`}
                    required
                  />
                </Field>
              </div>

              <div className="rounded-md border border-gray-200 p-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="label-xs">Computed Rate</div>
                  <div className="font-mono text-sm font-semibold text-gray-900" data-testid="convert-rate-display">
                    {liveRate > 0 ? `1 ${convertForm.from_coin} = ${liveRate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${convertForm.to_coin}` : '—'}
                  </div>
                </div>
                <div>
                  <div className="label-xs">Inverse Rate</div>
                  <div className="font-mono text-sm text-gray-700">
                    {liveRate > 0 ? `1 ${convertForm.to_coin} = ${(1 / liveRate).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${convertForm.from_coin}` : '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Exchange Fee (optional)"><input className="input-axistra font-mono" value={convertForm.fee_amount} onChange={(e) => setConvertForm({ ...convertForm, fee_amount: e.target.value })} placeholder="0" /></Field>
                <Field label="Fee Currency"><select className="input-axistra" value={convertForm.fee_currency} onChange={(e) => setConvertForm({ ...convertForm, fee_currency: e.target.value })}>{availableFromCoins.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              </div>
              <Field label="Notes (optional)"><textarea rows={2} className="input-axistra" value={convertForm.notes} onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })} placeholder="e.g. Binance instant convert order #12345" /></Field>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setConvertOpen(false)} className="btn-secondary">Cancel</button>
                <button data-testid="convert-submit" type="submit" disabled={loading || overdraft} className="btn-primary disabled:opacity-50">{loading ? 'Recording…' : 'Record Conversion'}</button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* Cashout modal */}
      <Modal open={cashoutOpen} onClose={() => setCashoutOpen(false)} title="Step 3 · Withdraw AED to Wio Bank" size="lg" testId="modal-cashout">
        <div className="mb-3 rounded-md border border-axistra-green/30 bg-[var(--axistra-green-light)] p-3 text-xs text-gray-700">
          <strong className="text-axistra-green">AED-only bank withdrawal.</strong> Moves AED from Binance/OKX → Wio Bank. Net deposit = AED amount − bank fee. Only do this after converting your crypto to AED in Step 2.
        </div>
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

      {/* Reconciliation audit modal */}
      <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title={`Reconcile ${active} Ledger`} size="lg" testId="modal-audit">
        {auditLoading || !audit ? (
          <div className="py-10 text-center text-sm text-gray-500">Loading audit…</div>
        ) : (
          <div className="space-y-5 text-sm" data-testid="audit-body">
            <div className="card-axistra p-4 bg-[var(--axistra-bg)]">
              <div className="label-xs">Current Balance</div>
              <div className="mt-1 flex flex-wrap gap-3">
                {audit.balance.map((b) => (
                  <span key={b.coin} className="font-mono text-base font-semibold text-axistra-green">{b.amount} {b.coin}</span>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-500">{audit.deposit_row_count} deposit row(s) in this wallet.</div>
            </div>

            {audit.breakdown && audit.breakdown.length > 0 && (
              <div>
                <div className="font-display font-semibold mb-2">Per-coin breakdown by tx type</div>
                <div className="text-xs text-gray-500 mb-2">Use this to spot drift: e.g. if BTC shows <code>deposit +0.017</code> but <code>convert_from -0.013</code>, the net BTC = 0.004 (the orphan).</div>
                <div className="space-y-3">
                  {audit.breakdown.map((b) => (
                    <div key={b.coin} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-mono font-semibold">{b.coin}</div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-axistra-green">Balance: {b.balance}</div>
                          {parseFloat(b.balance) > 0 && b.coin !== 'USDT' && SUPPORTS_CONVERT(active) && (
                            <button
                              type="button"
                              onClick={() => {
                                setAuditOpen(false);
                                const coins = WALLET_ICONS[active]?.coins || ['USDT'];
                                const toCoin = coins.find((c) => c !== b.coin) || 'USDT';
                                setConvertForm({
                                  ...initialConvertForm(active),
                                  from_coin: b.coin,
                                  to_coin: toCoin,
                                  from_amount: b.balance,
                                  fee_currency: toCoin,
                                });
                                setConvertOpen(true);
                              }}
                              className="text-[11px] rounded-md bg-axistra-green/10 hover:bg-axistra-green/20 text-axistra-green font-semibold px-2 py-1"
                              data-testid={`audit-convert-${b.coin}`}
                              title={`Open the Convert modal pre-filled with ${b.balance} ${b.coin} from this wallet`}
                            >
                              Convert remaining →
                            </button>
                          )}
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="text-gray-500">
                          <tr><th className="text-left">TX Type</th><th className="text-right">Count</th><th className="text-right">Net Amount</th></tr>
                        </thead>
                        <tbody>
                          {b.types.map((t) => (
                            <tr key={t.tx_type} className="border-t border-gray-100">
                              <td className="py-1 font-mono">{t.tx_type}</td>
                              <td className="py-1 text-right">{t.count}</td>
                              <td className={`py-1 text-right font-mono ${parseFloat(t.total) < 0 ? 'text-red-700' : 'text-axistra-green'}`}>{parseFloat(t.total) >= 0 ? '+' : ''}{t.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="font-display font-semibold mb-2 flex items-center gap-2">
                Duplicate TX hashes
                <span className={`badge ${audit.duplicates.length ? 'badge-red' : 'badge-green'}`}>{audit.duplicates.length}</span>
              </div>
              {audit.duplicates.length === 0 ? (
                <div className="text-xs text-gray-500">No duplicate hashes — each on-chain TX credits the wallet exactly once.</div>
              ) : (
                <div className="space-y-3">
                  {audit.duplicates.map((d) => (
                    <div key={d.tx_hash} className="border border-red-200 rounded-md p-3 bg-red-50/40">
                      <div className="font-mono text-xs break-all">{d.tx_hash}</div>
                      <div className="text-xs mt-1">Counted {d.count}× · total <span className="font-mono text-red-700">{d.total_amount}</span></div>
                      <div className="mt-2 space-y-1">
                        {d.rows.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <div className="font-mono">+{r.amount} {r.coin} <span className="text-gray-400">· {r.counterparty || '—'} · {r.external_ref || '—'}</span></div>
                            <button onClick={async () => { if (!window.confirm('Delete this duplicate ledger row?')) return; try { await api.delete(`/wallets/ledger/${r.id}`); toast.success('Deleted'); await loadOverview(); await loadLedger(); await openAudit(); } catch (err) { toast.error('Delete failed'); } }} className="text-red-700 hover:underline">delete</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="font-display font-semibold mb-2 flex items-center gap-2">
                Deposits without TX hash
                <span className={`badge ${audit.missing_tx_hash.count ? 'badge-yellow' : 'badge-green'}`}>{audit.missing_tx_hash.count}</span>
              </div>
              {audit.missing_tx_hash.count === 0 ? (
                <div className="text-xs text-gray-500">All deposit rows have a TX hash — clean.</div>
              ) : (
                <>
                  <div className="text-xs text-gray-600 mb-2">Total <span className="font-mono text-yellow-700">{audit.missing_tx_hash.total_amount}</span> — likely manual entries or auto-converted internal credits. Verify each.</div>
                  <div className="space-y-1">
                    {audit.missing_tx_hash.rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs border-b border-gray-100 py-1">
                        <div className="font-mono">+{r.amount} {r.coin} <span className="text-gray-400">· {r.counterparty || '—'} · {r.external_ref || '—'} · {r.notes || ''}</span></div>
                        <button onClick={async () => { if (!window.confirm('Delete this orphan ledger row?')) return; try { await api.delete(`/wallets/ledger/${r.id}`); toast.success('Deleted'); await loadOverview(); await loadLedger(); await openAudit(); } catch (err) { toast.error('Delete failed'); } }} className="text-red-700 hover:underline">delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div>
              <div className="font-display font-semibold mb-2 flex items-center gap-2">
                Deposits not linked to a recharge
                <span className={`badge ${audit.orphan_no_recharge.count ? 'badge-yellow' : 'badge-green'}`}>{audit.orphan_no_recharge.count}</span>
              </div>
              {audit.orphan_no_recharge.count === 0 ? (
                <div className="text-xs text-gray-500">All deposits trace back to a customer recharge — perfect audit chain.</div>
              ) : (
                <>
                  <div className="text-xs text-gray-600 mb-2">Total <span className="font-mono text-yellow-700">{audit.orphan_no_recharge.total_amount}</span> — these credited the wallet but no customer recharge exists in the portal. Common after deleting a recharge that left ledger debris, or webhooks for tx_hashes the portal never created an invoice for.</div>
                  <div className="space-y-1">
                    {audit.orphan_no_recharge.rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs border-b border-gray-100 py-1">
                        <div className="font-mono">+{r.amount} {r.coin} <span className="text-gray-400">· {r.tx_hash ? r.tx_hash.slice(0, 10) + '…' : 'no-hash'} · {r.counterparty || '—'} · {r.notes || ''}</span></div>
                        <button onClick={async () => { if (!window.confirm('Delete this orphan ledger row?')) return; try { await api.delete(`/wallets/ledger/${r.id}`); toast.success('Deleted'); await loadOverview(); await loadLedger(); await openAudit(); } catch (err) { toast.error('Delete failed'); } }} className="text-red-700 hover:underline">delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
