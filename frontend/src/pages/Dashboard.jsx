import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, KpiCard } from '../components/Atoms';
import { fmtMoney, fmtNumber } from '../lib/format';
import { CurrencyCircleDollar, Wallet, Users, Warning, Bank, ChartLineUp, Receipt, ShieldWarning } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [chart, setChart] = useState([]);
  const [recent, setRecent] = useState({ recharges: [], compliance: [] });

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/kpis').then((r) => setKpis(r.data)),
      api.get('/dashboard/chart').then((r) => setChart(r.data)),
      api.get('/dashboard/recent').then((r) => setRecent(r.data)),
    ]);
  }, []);

  if (!kpis) return <div className="text-gray-500">Loading…</div>;

  const vatPct = kpis.vat.pct.toFixed(1);
  const chartData = chart.map((c) => ({ month: c.month, sales: parseFloat(c.sales || 0), count: parseInt(c.count, 10) }));

  return (
    <div>
      <PageHeader
        eyebrow="Live Performance"
        title="Dashboard"
        subtitle="Real-time view of recharges, treasury flow, expenses and compliance posture."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Today's Sales" value={fmtMoney(kpis.daily.sales)} sub={`${kpis.daily.count} recharges`} icon={CurrencyCircleDollar} testId="kpi-daily-sales" />
        <KpiCard label="Monthly Sales" value={fmtMoney(kpis.monthly.sales)} sub={`Profit: ${fmtMoney(kpis.monthly.profit)}`} icon={ChartLineUp} testId="kpi-monthly-sales" />
        <KpiCard label="Crypto Received (USDT)" value={fmtNumber(kpis.treasury.total_crypto_received)} sub={`${fmtNumber(kpis.treasury.total_aed_converted)} AED converted`} icon={Wallet} testId="kpi-crypto-received" />
        <KpiCard label="Wio Deposits (AED)" value={fmtNumber(kpis.treasury.total_wio_deposits)} sub="Bank reconciled" icon={Bank} accent testId="kpi-wio-deposits" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <KpiCard label="Yearly Sales" value={fmtMoney(kpis.yearly.sales)} sub={`Gross profit ${fmtMoney(kpis.yearly.gross_profit)}`} icon={ChartLineUp} testId="kpi-yearly-sales" />
        <KpiCard label="Pending Reconciliation" value={kpis.reconciliation.pending} sub={`${kpis.reconciliation.mismatch} mismatches`} icon={Warning} testId="kpi-pending-recon" />
        <KpiCard label="Customers" value={kpis.customers.total} sub={`${kpis.customers.high_risk} high-risk`} icon={Users} testId="kpi-customers" />
        <KpiCard label="Monthly Expenses" value={fmtMoney(kpis.monthly.expenses)} sub="AED equivalent" icon={Receipt} testId="kpi-monthly-expenses" />
      </div>

      {/* Chart + VAT tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="card-axistra p-6 lg:col-span-2" data-testid="dashboard-chart">
          <div className="label-xs mb-1">Last 12 Months</div>
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
                <YAxis stroke="#9CA3AF" fontSize={11} />
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" stroke="#0A5C3E" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-axistra p-6" data-testid="dashboard-vat">
          <div className="label-xs mb-1">UAE VAT Threshold (375,000 AED)</div>
          <h3 className="font-display text-xl font-semibold">YTD Tracker</h3>
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <div className="font-display text-3xl font-bold text-axistra-green">{vatPct}%</div>
              <div className="text-xs text-gray-500">{fmtNumber(kpis.vat.ytd_aed)} / {fmtNumber(kpis.vat.threshold_aed)} AED</div>
            </div>
            <div className="mt-3 h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--axistra-green)] to-[var(--axistra-gold)] transition-all"
                style={{ width: `${Math.min(100, kpis.vat.pct)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-4 leading-relaxed">
              Once YTD taxable supply crosses AED 375,000 (rolling 12 months), VAT registration is mandatory.
              Tracker uses 3.67 AED conversion for non-AED currencies.
            </p>
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
                  <div className="text-sm font-medium text-gray-900">{r.customer?.full_name || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold">{fmtMoney(r.amount, r.currency)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">{r.status.replace(/_/g, ' ')}</div>
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
                  <span className="font-medium text-gray-900">{c.action.replace(/_/g, ' ')}</span>
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
