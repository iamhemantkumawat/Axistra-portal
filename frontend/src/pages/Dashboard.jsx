import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader } from '../components/Atoms';
import { fmtNumber } from '../lib/format';
import { useCurrency } from '../lib/currency';
import {
  CurrencyCircleDollar, Wallet, Users, Warning, Bank, ChartLineUp, Receipt, ShieldWarning,
  TrendUp, TrendDown, FileText, Briefcase, ArrowsClockwise, Fire,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer, Tooltip, CartesianGrid, AreaChart, Area, XAxis, YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [chart, setChart] = useState([]);
  const [recent, setRecent] = useState({ recharges: [], compliance: [] });
  const [topCustomers, setTopCustomers] = useState([]);
  const { format } = useCurrency();

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/kpis').then((r) => setKpis(r.data)),
      api.get('/dashboard/chart').then((r) => setChart(r.data)),
      api.get('/dashboard/recent').then((r) => setRecent(r.data)),
      api.get('/dashboard/top-customers').then((r) => setTopCustomers(r.data)).catch(() => {}),
    ]);
  }, []);

  if (!kpis) return <div className="text-gray-500 p-6">Loading dashboard…</div>;

  const vatPct = kpis.vat.pct.toFixed(1);
  // Backend returns sales_aed in AED — useCurrency().format converts to user-selected display currency.
  const chartData = chart.map((c) => ({ month: c.month, sales: c.sales_aed, count: c.count }));

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        eyebrow="Live performance · AED canonical"
        title="Dashboard"
        subtitle="Real-time view of recharges (FX-converted to AED), treasury flow, payroll due, invoices and compliance posture."
      />

      {/* Row 1 — Money flowing in */}
      <SectionLabel icon={CurrencyCircleDollar}>Revenue (FX-converted to AED)</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-today"
          icon={CurrencyCircleDollar}
          label="Today's Sales"
          value={format(kpis.daily.sales_aed, 'AED')}
          delta={kpis.daily.delta_pct}
          sub={<CurrencyBreakdown items={kpis.daily.currencies} count={kpis.daily.count} />}
        />
        <StatCard
          testId="kpi-month"
          icon={ChartLineUp}
          label="This Month"
          value={format(kpis.monthly.sales_aed, 'AED')}
          delta={kpis.monthly.delta_pct}
          sub={<span>{kpis.monthly.count} recharges · Prev: {format(kpis.prev_month.sales_aed, 'AED')}</span>}
        />
        <StatCard
          testId="kpi-30d"
          icon={ArrowsClockwise}
          label="Last 30 Days"
          value={format(kpis.thirty_day.sales_aed, 'AED')}
          sub={<CurrencyBreakdown items={kpis.thirty_day.currencies} count={kpis.thirty_day.count} />}
        />
        <StatCard
          testId="kpi-year"
          icon={ChartLineUp}
          label="Year-to-Date"
          value={format(kpis.yearly.sales_aed, 'AED')}
          sub={<span>Gross profit {format(kpis.yearly.gross_profit_aed, 'AED')}</span>}
          accent
        />
      </div>

      {/* Row 2 — Money flowing out / obligations */}
      <SectionLabel icon={Receipt}>Obligations &amp; cashflow</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-month-expense"
          icon={Receipt}
          label="Monthly Expenses"
          value={format(kpis.monthly.expenses_aed, 'AED')}
          sub={<span>Prev: {format(kpis.prev_month.expenses_aed, 'AED')}</span>}
        />
        <StatCard
          testId="kpi-month-profit"
          icon={kpis.monthly.profit_aed >= 0 ? TrendUp : TrendDown}
          label="Monthly Profit"
          value={format(kpis.monthly.profit_aed, 'AED')}
          accent={kpis.monthly.profit_aed >= 0}
          sub={<span className={kpis.monthly.profit_aed >= 0 ? 'text-axistra-green' : 'text-red-600'}>
            {kpis.monthly.profit_aed >= 0 ? 'In profit' : 'In loss'}
          </span>}
        />
        <StatCard
          testId="kpi-payroll-due"
          icon={Briefcase}
          label="Payroll Due"
          value={format(kpis.payroll.due_aed, 'AED')}
          sub={kpis.payroll.due_period
            ? <span><Link className="text-axistra-green hover:underline" to="/payroll">{kpis.payroll.due_period}</Link> · {kpis.payroll.due_status}</span>
            : <span>No pending run</span>}
        />
        <StatCard
          testId="kpi-burn"
          icon={Fire}
          label="Burn Rate (30d)"
          value={format(kpis.cashflow.burn_rate_monthly_aed, 'AED')}
          sub={<span>≈ {format(kpis.cashflow.avg_daily_expense_aed, 'AED')} / day</span>}
        />
      </div>

      {/* Row 3 — Treasury health */}
      <SectionLabel icon={Wallet}>Treasury &amp; bank</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-crypto"
          icon={Wallet}
          label="Crypto Received (USDT)"
          value={fmtNumber(kpis.treasury.total_crypto_received_usdt)}
          sub={<span>{fmtNumber(kpis.treasury.total_aed_converted)} AED converted</span>}
        />
        <StatCard
          testId="kpi-wio-deposits"
          icon={Bank}
          label="Wio Deposits"
          value={format(kpis.treasury.total_wio_deposits, 'AED')}
          sub={<span>Bank reconciled</span>}
          accent
        />
        <StatCard
          testId="kpi-drift"
          icon={Warning}
          label="Drift to Settle"
          value={format(kpis.treasury.drift_to_settle, 'AED')}
          sub={kpis.treasury.drift_to_settle > 0 ? <span className="text-amber-700">AED sitting on exchanges</span> : <span>All settled to bank</span>}
        />
        <StatCard
          testId="kpi-bank-balance"
          icon={Bank}
          label="Bank Balance (opening)"
          value={format(kpis.banks.total_aed, 'AED')}
          sub={<span>{kpis.banks.active_count} active account(s)</span>}
        />
      </div>

      {/* Row 4 — Posture */}
      <SectionLabel icon={ShieldWarning}>Posture</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          testId="kpi-customers"
          icon={Users}
          label="Customers"
          value={kpis.customers.total}
          sub={<span>{kpis.customers.new_this_month} new this month · {kpis.customers.high_risk} high-risk</span>}
        />
        <StatCard
          testId="kpi-pending-recon"
          icon={Warning}
          label="Pending Reconciliation"
          value={kpis.reconciliation.pending}
          sub={<span>{kpis.reconciliation.mismatch} mismatches</span>}
        />
        <StatCard
          testId="kpi-invoices-open"
          icon={FileText}
          label="Open Invoices"
          value={kpis.invoices.open_count}
          sub={<span>{format(kpis.invoices.open_value_aed, 'AED')} outstanding</span>}
        />
        <StatCard
          testId="kpi-vat"
          icon={ShieldWarning}
          label="VAT Threshold YTD"
          value={`${vatPct}%`}
          sub={<VatBar pct={kpis.vat.pct} ytd={kpis.vat.ytd_aed} cap={kpis.vat.threshold_aed} />}
        />
      </div>

      {/* Sales chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="card-axistra p-6 lg:col-span-2" data-testid="dashboard-chart">
          <div className="label-xs mb-1">Last 12 Months · AED equivalent</div>
          <h3 className="font-display text-xl font-semibold mb-4">Sales Trend</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0A5C3E" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#0A5C3E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="month" stroke="#9CA3AF" fontSize={11} />
                <YAxis stroke="#9CA3AF" fontSize={11} tickFormatter={(v) => Number(v).toLocaleString('en-AE', { notation: 'compact' })} />
                <Tooltip
                  contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12 }}
                  formatter={(v, name) => name === 'sales' ? [format(Number(v), 'AED'), 'Sales'] : [v, name]}
                />
                <Area type="monotone" dataKey="sales" stroke="#0A5C3E" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-axistra p-6" data-testid="dashboard-top-customers">
          <div className="label-xs mb-1">This month</div>
          <h3 className="font-display text-xl font-semibold mb-4">Top Customers</h3>
          {topCustomers.length === 0 && <div className="text-sm text-gray-500">No recharges this month yet.</div>}
          <div className="space-y-2">
            {topCustomers.map((c, idx) => (
              <Link
                key={c.customer_id || idx}
                to={c.customer_id ? `/customers/${c.customer_id}` : '/customers'}
                className="flex items-center justify-between p-2.5 rounded-md hover:bg-gray-50 border border-gray-100"
              >
                <div>
                  <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400">{c.recharges} recharge(s)</div>
                </div>
                <div className="font-mono text-sm text-axistra-green font-bold">{format(c.aed, 'AED')}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card-axistra p-6" data-testid="recent-recharges">
          <div className="flex justify-between mb-4">
            <h3 className="font-display text-lg font-semibold">Recent Recharges</h3>
            <Link to="/recharges" className="text-xs text-axistra-green hover:underline">View all →</Link>
          </div>
          <div className="space-y-3">
            {recent.recharges.length === 0 && <div className="text-sm text-gray-500">No recharges yet.</div>}
            {recent.recharges.map((r) => (
              <Link to={`/recharges/${r.id}`} key={r.id} className="flex items-center justify-between p-3 rounded-md border border-gray-100 hover:bg-gray-50">
                <div>
                  <div className="font-mono text-xs text-axistra-green">{r.recharge_code}</div>
                  <div className="text-sm font-medium text-gray-900">{r.customer?.full_name || r.magnus_username || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold">{format(r.amount, r.currency)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">{(r.status || '').replace(/_/g, ' ')}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card-axistra p-6" data-testid="recent-compliance">
          <div className="flex justify-between mb-4">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2"><ShieldWarning size={18} weight="duotone" /> Compliance Activity</h3>
            <Link to="/compliance" className="text-xs text-axistra-green hover:underline">View all →</Link>
          </div>
          <div className="space-y-3">
            {recent.compliance.length === 0 && <div className="text-sm text-gray-500">No compliance actions yet.</div>}
            {recent.compliance.map((c) => (
              <div key={c.id} className="p-3 rounded-md border border-gray-100 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{(c.action || '').replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                {c.notes && <div className="text-xs text-gray-600 mt-1">{c.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Small helpers
// ============================================================
function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      {Icon && <Icon size={14} weight="duotone" className="text-axistra-green" />}
      <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-semibold">{children}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, delta, accent, testId }) {
  const deltaText = (() => {
    if (delta === null || delta === undefined) return null;
    const sign = delta >= 0 ? '+' : '';
    return { text: `${sign}${delta.toFixed(1)}%`, positive: delta >= 0 };
  })();
  return (
    <div
      className={`card-axistra p-4 relative overflow-hidden ${accent ? 'bg-gradient-to-br from-[var(--axistra-green-light)] to-white border-axistra-green/20' : ''}`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-500 font-semibold">
          {Icon && <Icon size={14} weight="duotone" className={accent ? 'text-axistra-green' : 'text-gray-400'} />}
          <span>{label}</span>
        </div>
        {deltaText && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${deltaText.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {deltaText.text}
          </span>
        )}
      </div>
      <div className={`font-display font-bold mt-2 text-2xl ${accent ? 'text-axistra-green' : 'text-gray-900'} truncate`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}

function CurrencyBreakdown({ items = [], count }) {
  if (!items || items.length === 0) return <span>{count} recharge(s)</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      <span className="text-gray-500">{count} recharge(s) ·</span>
      {items.map((b) => (
        <span key={b.currency} className="text-gray-700">
          <span className="font-mono">{Number(b.amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> <span className="text-[10px] uppercase text-gray-400">{b.currency}</span>
        </span>
      ))}
    </span>
  );
}

function VatBar({ pct, ytd, cap }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500">{fmtNumber(ytd)} / {fmtNumber(cap)} AED</div>
      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--axistra-green)] to-[var(--axistra-gold)] transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
