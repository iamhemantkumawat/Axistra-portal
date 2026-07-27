import React, { useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, KpiCard } from '../components/Atoms';
import { downloadBlob, fmtMoney } from '../lib/format';
import {
  FileXls, FileCsv, FilePdf, ChartBar, ChartLine, ChartPie, CurrencyDollar,
  TrendUp, Bank, Coins, Package, Receipt, Wallet, Sparkle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const REPORTS = [
  { key: 'monthly-sales',       name: 'Monthly Sales',          icon: ChartLine },
  { key: 'quarterly-sales',     name: 'Quarterly Sales',        icon: ChartBar },
  { key: 'yearly-pl',           name: 'Yearly P&L',             icon: TrendUp },
  { key: 'customer-recharge',   name: 'Customer Recharge',      icon: Receipt },
  { key: 'crypto-to-aed',       name: 'Crypto → AED Conversion', icon: Coins },
  { key: 'bank-reconciliation', name: 'Bank Reconciliation',    icon: Bank },
  { key: 'vat-threshold',       name: 'VAT Threshold',          icon: Wallet },
  { key: 'corporate-tax',       name: 'Corporate Tax',          icon: CurrencyDollar },
  { key: 'expenses',            name: 'Expense Report',         icon: Receipt },
  { key: 'suspicious',          name: 'Suspicious Activity',    icon: ChartPie },
  { key: 'sales-journal',       name: 'Sales Journal (VAT-ready)',    icon: Receipt, ca: true },
  { key: 'vat-return',          name: 'VAT Return (VAT201-style)',    icon: Wallet, ca: true },
  { key: 'expense-ledger',      name: 'Expense Ledger (Detailed)',    icon: Receipt, ca: true },
  { key: 'corporate-tax-working', name: 'Corporate Tax Working Paper', icon: CurrencyDollar, ca: true },
];

const COLORS = ['#0A5C3E', '#C6A14B', '#1E7D5C', '#E0BC4F', '#3D9974', '#F0D88A', '#5BB58C', '#996A1F', '#80C99F', '#705425'];

export default function Reports() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [charts, setCharts] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState('');
  const [bundling, setBundling] = useState(false);

  useEffect(() => {
    api.get(`/reports/dashboard/charts?year=${year}`).then((r) => setCharts(r.data)).catch(() => setCharts(null));
  }, [year]);

  const view = async (key) => {
    setLoading(key);
    try {
      const { data } = await api.get(`/reports/${key}?year=${year}`);
      setPreview({ key, data });
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to load ${key}`);
    } finally { setLoading(''); }
  };

  const csv = (key)  => downloadBlob(`${API_BASE}/reports/export/csv?report=${key}&year=${year}`,  `${key}-${year}.csv`);
  const excel = (key) => downloadBlob(`${API_BASE}/reports/export/excel?report=${key}&year=${year}`, `${key}-${year}.xlsx`);
  const pdf = (key)   => downloadBlob(`${API_BASE}/reports/export/pdf?report=${key}&year=${year}`,   `${key}-${year}.pdf`);

  const downloadBundle = async () => {
    setBundling(true);
    try {
      await downloadBlob(`${API_BASE}/reports/bundle/month-end?year=${year}&month=${month}`, `axistra-month-end-${year}-${month}.zip`);
    } finally { setBundling(false); }
  };

  const downloadAccountantPack = async () => {
    setBundling(true);
    try {
      await downloadBlob(`${API_BASE}/reports/bundle/accountant-pack?year=${year}`, `axistra-accountant-pack-${year}.zip`);
    } finally { setBundling(false); }
  };

  const kpis = charts?.kpis;

  return (
    <div data-testid="reports-page">
      <PageHeader
        eyebrow="Audit & Accountant Ready"
        title="Reports"
        subtitle="Live KPI dashboard with charts plus one-click PDF / Excel / CSV exports and an end-of-month accountant bundle."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="input-axistra w-28" data-testid="reports-year">
              {[year + 1, year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="input-axistra w-28" data-testid="reports-month">
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>{new Date(2000, parseInt(m, 10) - 1, 1).toLocaleString('en', { month: 'short' })}</option>
              ))}
            </select>
            <button onClick={downloadBundle} disabled={bundling} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" data-testid="reports-bundle">
              <Package size={16} /> {bundling ? 'Building…' : `Month-End ZIP`}
            </button>
            <button onClick={downloadAccountantPack} disabled={bundling} className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50" data-testid="reports-accountant-pack" title={`Full annual export with every report + manifest + README — designed for handover to an external accountant.`}>
              <FilePdf size={16} /> {bundling ? 'Building…' : `Accountant Pack (FY ${year})`}
            </button>
          </div>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Total Sales" testId="kpi-sales" icon={TrendUp} value={kpis ? fmtMoney(kpis.total_sales, 'AED') : '…'} />
        <KpiCard label="Total Expenses" testId="kpi-expenses" icon={Receipt} value={kpis ? fmtMoney(kpis.total_expenses, 'AED') : '…'} />
        <KpiCard label="Net Profit" testId="kpi-net-profit" icon={CurrencyDollar} accent value={kpis ? fmtMoney(kpis.net_profit, 'AED') : '…'} />
        <KpiCard label="VAT Progress" testId="kpi-vat" icon={Wallet} value={kpis ? `${kpis.vat_progress_pct.toFixed(1)}% of 375K` : '…'} sub={kpis ? `Remaining ${fmtMoney(kpis.vat_remaining_aed, 'AED')}` : ''} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="card-axistra p-5 lg:col-span-2" data-testid="chart-monthly-trend">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="label-xs">Trend</div>
              <h3 className="font-display text-lg font-semibold">Monthly Sales — {year}</h3>
            </div>
            <ChartLine size={22} weight="duotone" className="text-axistra-green" />
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={charts?.monthly_trend || []}>
                <defs>
                  <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0A5C3E" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#0A5C3E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1EF" />
                <XAxis dataKey="month" stroke="#6B7B75" fontSize={11} />
                <YAxis stroke="#6B7B75" fontSize={11} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E3E7E5', borderRadius: 6, fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" stroke="#0A5C3E" strokeWidth={2.4} fill="url(#trendGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-axistra p-5" data-testid="chart-method-split">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="label-xs">Mix</div>
              <h3 className="font-display text-lg font-semibold">Payment Method</h3>
            </div>
            <ChartPie size={22} weight="duotone" className="text-axistra-green" />
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={charts?.payment_method_split || []}
                  dataKey="total"
                  nameKey="method"
                  innerRadius={48}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {(charts?.payment_method_split || []).map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E3E7E5', borderRadius: 6, fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8">
        <div className="card-axistra p-5 lg:col-span-2" data-testid="chart-top-customers">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="label-xs">Top 10</div>
              <h3 className="font-display text-lg font-semibold">Top Customers — {year}</h3>
            </div>
            <ChartBar size={22} weight="duotone" className="text-axistra-green" />
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={charts?.top_customers || []} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1EF" />
                <XAxis type="number" stroke="#6B7B75" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#6B7B75" fontSize={11} width={140} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E3E7E5', borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="total" fill="#0A5C3E" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-axistra p-5" data-testid="chart-gateway-split">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="label-xs">Mix</div>
              <h3 className="font-display text-lg font-semibold">Gateway Split</h3>
            </div>
            <Sparkle size={22} weight="duotone" className="text-axistra-gold" />
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={charts?.gateway_split || []}
                  dataKey="total"
                  nameKey="gateway"
                  outerRadius={104}
                >
                  {(charts?.gateway_split || []).map((entry, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E3E7E5', borderRadius: 6, fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="card-axistra p-5" data-testid={`report-card-${r.key}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="label-xs">Report</div>
                  <h3 className="font-display text-lg font-semibold mt-0.5">{r.name}</h3>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--axistra-green-light)] text-axistra-green">
                  <Icon size={18} weight="duotone" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button onClick={() => view(r.key)} disabled={loading === r.key} className="btn-secondary text-xs disabled:opacity-50" data-testid={`report-view-${r.key}`}>
                  {loading === r.key ? 'Loading…' : 'View'}
                </button>
                <button onClick={() => pdf(r.key)} className="btn-secondary text-xs inline-flex items-center justify-center gap-1" data-testid={`report-pdf-${r.key}`}><FilePdf size={14} /> PDF</button>
                <button onClick={() => excel(r.key)} className="btn-secondary text-xs inline-flex items-center justify-center gap-1" data-testid={`report-excel-${r.key}`}><FileXls size={14} /> Excel</button>
                <button onClick={() => csv(r.key)} className="btn-secondary text-xs inline-flex items-center justify-center gap-1" data-testid={`report-csv-${r.key}`}><FileCsv size={14} /> CSV</button>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div ref={(el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="card-axistra p-6" data-testid="report-preview">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-display text-lg font-semibold">Preview — {preview.key}</h3>
            <button onClick={() => setPreview(null)} className="text-xs text-gray-500 hover:text-gray-900" data-testid="preview-close">Close</button>
          </div>
          <ReportPreviewRenderer data={preview.data} testKey={preview.key} />
        </div>
      )}
    </div>
  );
}

/**
 * Renders a report response as a proper table + summary block. Falls back to
 * a formatted JSON view only when the payload shape isn't recognised. Used
 * by the "View" button on each report card — replaces the previous raw-<pre>
 * dump that read as "not working" to a CA.
 */
function ReportPreviewRenderer({ data, testKey }) {
  if (data == null) return <div className="text-sm text-gray-500">No data.</div>;
  const rowKeys = ['rows', 'movements', 'high_risk_customers', 'recent_compliance_actions'];
  let rows = null;
  let summaryEntries = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === 'object') {
    for (const k of rowKeys) {
      if (Array.isArray(data[k])) { rows = data[k]; break; }
    }
    // Flatten top-level entries — nested objects become their own group of
    // labelled KPI tiles (e.g. output_vat.sales_gross_aed → "Sales gross aed"
    // tile) instead of a raw JSON blob. This is the whole point of the CA-
    // friendly preview: no {curly braces} in front of the accountant.
    const seen = new Set();
    Object.entries(data).forEach(([k, v]) => {
      if (rowKeys.includes(k) || v == null) return;
      if (typeof v === 'object' && !Array.isArray(v)) {
        Object.entries(v).forEach(([kk, vv]) => {
          if (vv == null || typeof vv === 'object') return;
          const label = `${k}: ${kk}`.replace(/_/g, ' ');
          if (!seen.has(label)) { seen.add(label); summaryEntries.push([label, vv, kk]); }
        });
      } else if (!Array.isArray(v)) {
        const label = k.replace(/_/g, ' ');
        if (!seen.has(label)) { seen.add(label); summaryEntries.push([label, v, k]); }
      }
    });
  }
  const cols = rows && rows.length ? Object.keys(rows[0]) : [];
  const fmtVal = (v, keyHint) => {
    if (v == null) return '—';
    // Coerce numeric strings so table cells (which arrive as string from PG)
    // get the same money formatting as scalar KPI tiles.
    let n = v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) n = Number(v);
    if (typeof n === 'number') {
      const isIdentifier = /year|quarter|month\b|count|pct|rate|threshold_pct/i.test(keyHint || '');
      const looksMoney = /aed|usd|amount|total|net|gross|payable|refund|revenue|profit|tax|balance|value|sales|expense|debit|credit|fee|price|salary|payroll/i.test(keyHint || '');
      if (isIdentifier) return String(n);
      return looksMoney
        ? n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : n.toLocaleString('en-AE');
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return (
    <div className="space-y-4" data-testid={`preview-body-${testKey}`}>
      {summaryEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryEntries.map(([k, v, keyHint]) => (
            <div key={k} className="rounded-md border border-gray-200 p-3 bg-gray-50">
              <div className="label-xs mb-1 capitalize">{k}</div>
              <div className="font-mono text-sm text-gray-900 break-all">{fmtVal(v, keyHint)}</div>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="min-w-full text-xs font-mono">
            <thead className="bg-[var(--axistra-green-light)] text-gray-700 sticky top-0">
              <tr>
                {cols.map((c) => <th key={c} className="text-left px-3 py-2 border-b border-gray-200 whitespace-nowrap uppercase tracking-wider text-[10px]">{c.replace(/_/g, ' ')}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r, i) => (
                <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50/40'}>
                  {cols.map((c) => (
                    <td key={c} className="px-3 py-1.5 border-b border-gray-100 whitespace-nowrap">
                      {fmtVal(r[c], c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && (
            <div className="text-[11px] text-gray-500 p-2 text-center border-t border-gray-200">
              Showing first 500 of {rows.length} rows. Download full report as CSV / Excel.
            </div>
          )}
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-6 border border-dashed rounded-md">No rows for this period.</div>
      ) : null}
    </div>
  );
}
