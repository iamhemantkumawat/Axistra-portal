import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { Modal, Field } from './Atoms';
import { toast } from 'sonner';
import {
  CircleNotch, CheckCircle, Clock, WarningCircle, ArrowRight, Receipt, Coin, Bank, Wallet,
  Buildings, ArrowsLeftRight, MagnifyingGlass, ClipboardText, FileArrowUp,
} from '@phosphor-icons/react';

const fmtNumber = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

const STAGE_ICONS = {
  customer: Receipt, gateway: Coin, magnus: Wallet, sweep: Buildings,
  usdt: Coin, aed: ArrowsLeftRight, wio: Bank,
};

const STATUS_STYLE = {
  done: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  pending: 'bg-amber-50 border-amber-300 text-amber-700',
  na: 'bg-gray-50 border-gray-200 text-gray-400',
  mismatch: 'bg-red-50 border-red-300 text-red-700',
};

/* ─── In Flight tab ─── customers whose payment chain isn't fully closed ─── */
export function InFlightTab({ recharges, batches }) {
  const inFlight = useMemo(() => {
    return (recharges || []).filter((r) => {
      if (r.reconciled) return false;
      if (['refunded', 'cancelled'].includes(r.status)) return false;
      return true;
    });
  }, [recharges]);

  const grouped = useMemo(() => {
    const buckets = {
      no_chain: { label: 'No on-chain transaction yet', items: [] },
      no_magnus: { label: 'On-chain done, awaiting Magnus credit', items: [] },
      no_batch: { label: 'Magnus credited, awaiting batching', items: [] },
      in_exchange: { label: 'In exchange (USDT/AED conversion pending)', items: [] },
      no_wio: { label: 'AED converted, awaiting Wio deposit', items: [] },
      mismatch: { label: 'Amount mismatches', items: [] },
    };
    for (const r of inFlight) {
      if (r.status === 'mismatch') { buckets.mismatch.items.push(r); continue; }
      if (!r.tx_hash && !(r.crypto_transactions || []).length) { buckets.no_chain.items.push(r); continue; }
      if (!r.magnus_credited_at) { buckets.no_magnus.items.push(r); continue; }
      const b = r.treasury && batches.find((x) => x.id === r.treasury.treasury_batch_id);
      if (!b) { buckets.no_batch.items.push(r); continue; }
      if (b.status === 'reconciled' || b.bank_reference) continue; // shouldn't happen but skip
      if (!b.fiat_received) { buckets.in_exchange.items.push({ ...r, batch: b }); continue; }
      buckets.no_wio.items.push({ ...r, batch: b });
    }
    return buckets;
  }, [inFlight, batches]);

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([key, b]) => (
        <BucketCard key={key} bucketKey={key} title={b.label} items={b.items} />
      ))}
    </div>
  );
}

function BucketCard({ bucketKey, title, items }) {
  if (items.length === 0) return null;
  const totalAed = items.reduce((s, r) => {
    const fx = { AED: 1, USD: 3.6725, EUR: 4, GBP: 4.6 };
    return s + (parseFloat(r.amount || 0) * (fx[(r.currency || 'USD').toUpperCase()] || 1));
  }, 0);
  return (
    <div className="card-axistra p-5" data-testid={`bucket-${bucketKey}`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-display text-base font-bold text-gray-900">{title}</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="badge badge-warning">{items.length}</span>
          <span className="font-mono text-gray-600">≈ AED {fmtNumber(totalAed)}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.slice(0, 12).map((r) => (
          <div key={r.id} className="rounded-md border border-gray-200 px-3 py-2 text-sm flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-mono text-axistra-green">{r.recharge_code}</div>
              <div className="text-xs text-gray-500 truncate">{r.customer?.full_name || r.customer?.email || '—'}</div>
            </div>
            <div className="text-right font-mono text-xs whitespace-nowrap">{fmtNumber(r.amount)} {r.currency}</div>
          </div>
        ))}
      </div>
      {items.length > 12 && (
        <div className="mt-2 text-xs text-gray-500">… and {items.length - 12} more</div>
      )}
    </div>
  );
}

/* ─── Audit Chain tab ─── visual lifecycle for a chosen recharge ─── */
export function AuditChainTab({ recharges }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [chainData, setChainData] = useState(null);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return (recharges || []).slice(0, 25);
    const q = search.toLowerCase();
    return (recharges || []).filter((r) =>
      (r.recharge_code || '').toLowerCase().includes(q) ||
      (r.customer?.full_name || '').toLowerCase().includes(q) ||
      (r.customer?.email || '').toLowerCase().includes(q) ||
      (r.tx_hash || '').toLowerCase().includes(q),
    ).slice(0, 25);
  }, [recharges, search]);

  useEffect(() => {
    if (!selectedId) { setChainData(null); return; }
    setLoading(true);
    api.get(`/treasury/chain/${selectedId}`).then((r) => setChainData(r.data)).catch(() => setChainData(null)).finally(() => setLoading(false));
  }, [selectedId]);

  const copyCsv = () => {
    if (!chainData) return;
    const lines = ['Stage,Status,Label,Ref,When,Detail'];
    for (const l of chainData.chain) {
      const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      lines.push([l.stage, l.status, l.label, l.ref || '', l.when || '', l.detail || ''].map(csv).join(','));
    }
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Chain copied as CSV');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="card-axistra p-5 lg:col-span-1">
        <div className="label-xs mb-1">Pick a Recharge</div>
        <h3 className="font-display text-base font-bold mb-3">Search</h3>
        <div className="relative mb-3">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="RCH-…, customer name, tx hash"
            className="input-axistra pl-8" data-testid="chain-search-input"
          />
        </div>
        <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
          {filtered.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm flex items-center justify-between ${selectedId === r.id ? 'border-axistra-green bg-[var(--axistra-green-light)]' : 'border-gray-200 hover:border-axistra-green/60'}`}
              data-testid={`chain-pick-${r.recharge_code}`}>
              <div className="min-w-0">
                <div className="font-mono text-axistra-green">{r.recharge_code}</div>
                <div className="text-[11px] text-gray-500 truncate">{r.customer?.full_name || r.customer?.email}</div>
              </div>
              <div className="text-[11px] font-mono whitespace-nowrap">{fmtNumber(r.amount)} {r.currency}</div>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">No matches.</div>}
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {!selectedId && (
          <div className="card-axistra p-10 text-center text-gray-500 text-sm">
            Pick a recharge from the left to see its full audit chain.
          </div>
        )}
        {selectedId && loading && (
          <div className="card-axistra p-10 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2">
            <CircleNotch size={16} className="animate-spin" /> Loading chain…
          </div>
        )}
        {chainData && !loading && (
          <>
            <div className="card-axistra p-5">
              <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
                <div>
                  <div className="label-xs mb-0.5">Audit Chain</div>
                  <h3 className="font-display text-lg font-bold text-gray-900">{chainData.recharge.recharge_code}</h3>
                  <div className="text-xs text-gray-500">{chainData.recharge.customer?.full_name || chainData.recharge.customer?.email}</div>
                </div>
                <button onClick={copyCsv} className="btn-secondary inline-flex items-center gap-1.5 text-xs" data-testid="chain-copy-csv">
                  <ClipboardText size={14} /> Copy chain CSV
                </button>
              </div>
              <ol className="space-y-2">
                {chainData.chain.map((link, i) => {
                  const Icon = STAGE_ICONS[link.stage] || ArrowRight;
                  const cls = STATUS_STYLE[link.status] || STATUS_STYLE.pending;
                  return (
                    <li key={link.stage} className={`flex items-start gap-3 rounded-md border px-4 py-3 ${cls}`} data-testid={`chain-link-${link.stage}`}>
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-current shrink-0">
                        {link.status === 'done' ? <CheckCircle size={18} weight="fill" /> :
                         link.status === 'pending' ? <Clock size={18} /> :
                         link.status === 'mismatch' ? <WarningCircle size={18} weight="fill" /> :
                         <Icon size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span className="font-semibold">{i + 1}. {link.label}</span>
                          {link.when && <span className="text-[11px] opacity-75 font-mono">{fmtDate(link.when)}</span>}
                        </div>
                        {link.ref && <div className="font-mono text-xs mt-0.5 truncate">{link.ref}</div>}
                        {link.detail && <div className="text-xs mt-0.5 opacity-85">{link.detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Profit by Conversion tab ─── per-recharge spread report ─── */
export function ProfitByConversionTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/treasury/customer-profit-by-conversion').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  const exportCsv = () => {
    if (!data?.rows?.length) return;
    const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Recharge', 'Customer', 'Invoice', 'Currency', 'Invoice AED', 'Batch', 'Status', 'AED Received', 'Profit AED', 'Margin %'].map(csv).join(',');
    const rows = data.rows.map((r) => [r.recharge_code, r.customer_name, r.invoice_amount, r.invoice_currency, r.invoice_amount_aed.toFixed(2), r.batch_code, r.batch_status, r.allocated_aed_received.toFixed(2), r.profit_aed.toFixed(2), r.margin_pct.toFixed(2)].map(csv).join(','));
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `customer-profit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (loading) return <div className="card-axistra p-10 text-center text-sm text-gray-500">Calculating…</div>;
  if (!data) return null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiBlock label="Customers" value={data.totals.rows} />
        <KpiBlock label="Total Invoiced (AED-eq)" value={`AED ${fmtNumber(data.totals.total_invoice_aed)}`} />
        <KpiBlock label="Total Received (AED)" value={`AED ${fmtNumber(data.totals.total_received_aed)}`} />
        <KpiBlock label="Net Profit (AED)" value={`AED ${fmtNumber(data.totals.total_profit_aed)}`} sub={`Avg margin ${data.totals.avg_margin_pct.toFixed(2)}%`} accent={data.totals.total_profit_aed >= 0} />
      </div>
      <div className="card-axistra p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base font-bold">Per-Recharge Spread</h3>
          <button onClick={exportCsv} className="btn-secondary text-xs" data-testid="profit-export-csv">Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table-axistra">
            <thead><tr><th>Recharge</th><th>Customer</th><th>Invoice</th><th>Invoice AED</th><th>Batch</th><th>AED Received</th><th>Profit</th><th>Margin</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.recharge_id} data-testid={`profit-row-${r.recharge_code}`}>
                  <td className="font-mono text-xs">{r.recharge_code}</td>
                  <td className="text-xs">{r.customer_name}</td>
                  <td className="font-mono text-xs">{fmtNumber(r.invoice_amount)} {r.invoice_currency}</td>
                  <td className="font-mono text-xs">{fmtNumber(r.invoice_amount_aed)}</td>
                  <td className="font-mono text-xs">{r.batch_code}</td>
                  <td className="font-mono text-xs">{fmtNumber(r.allocated_aed_received)}</td>
                  <td className={`font-mono text-xs ${r.profit_aed >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtNumber(r.profit_aed)}</td>
                  <td className={`font-mono text-xs ${r.margin_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{r.margin_pct.toFixed(2)}%</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-6">No batched recharges yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiBlock({ label, value, sub, accent }) {
  return (
    <div className={`rounded-md border px-4 py-3 ${accent ? 'border-axistra-green bg-[var(--axistra-green-light)]' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-display text-xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

/* ─── Bank Statement Import modal ─── upload Wio CSV and auto-match ─── */
export function BankStatementImportModal({ open, onClose, onMatched }) {
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const parseCsv = (txt) => {
    const lines = txt.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const head = lines[0].toLowerCase();
    // Auto-detect: date,ref,amount,description (any order, comma OR semicolon)
    const sep = head.includes(';') ? ';' : ',';
    const cols = head.split(sep).map((s) => s.trim());
    const dateIdx = cols.findIndex((c) => /date|posted/.test(c));
    const refIdx = cols.findIndex((c) => /(reference|ref|narration|description)/.test(c));
    const amtIdx = cols.findIndex((c) => /(amount|credit|cr|in)/.test(c));
    const descIdx = cols.findIndex((c) => /(description|memo|details|narration)/.test(c));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(sep);
      if (parts.length < 2) continue;
      const amount = parseFloat((parts[amtIdx] || '').replace(/[, ]/g, '')) || 0;
      if (amount <= 0) continue; // credits only
      rows.push({
        date: parts[dateIdx] || null,
        ref: (parts[refIdx] || '').trim(),
        amount,
        description: (parts[descIdx] || '').trim(),
      });
    }
    return rows;
  };

  const handleRun = async () => {
    const rows = parseCsv(csvText);
    if (!rows.length) { toast.error('Could not parse any rows from the CSV'); return; }
    setBusy(true);
    try {
      const res = await api.post('/treasury/import-bank-statement', { rows });
      setResult(res.data);
      toast.success(`${res.data.matched_count} matched / ${res.data.unmatched_count} unmatched`);
      onMatched?.(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import Wio Bank Statement" testId="bank-import-modal">
      <p className="text-xs text-gray-500 mb-3">
        Paste your Wio statement CSV (or any bank export) below. Expected columns include Date, Reference, Amount and Description in any order. Only credits are processed.
      </p>
      <Field label="CSV content">
        <textarea
          rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)}
          placeholder="Date,Reference,Amount,Description&#10;2026-05-28,IPI260528010KFXR,39329.40,OKX cashout"
          className="input-axistra font-mono text-xs"
          data-testid="bank-import-csv"
        />
      </Field>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onClose} className="btn-secondary">Close</button>
        <button onClick={handleRun} disabled={busy || !csvText.trim()} className="btn-primary inline-flex items-center gap-1.5" data-testid="bank-import-run">
          <FileArrowUp size={14} /> {busy ? 'Matching…' : 'Match against Wio ledger'}
        </button>
      </div>
      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
            <strong>{result.matched_count}</strong> statement lines matched existing Wio ledger rows.
          </div>
          {result.unmatched.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1">Unmatched lines ({result.unmatched.length}) — you may need to create a cashout for each:</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.unmatched.map((row, i) => (
                  <div key={i} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono">{row.ref || '—'}</div>
                      <div className="text-[11px] text-gray-500 truncate">{row.description || row.date || ''}</div>
                    </div>
                    <div className="font-mono whitespace-nowrap">{fmtNumber(row.amount)} AED</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
