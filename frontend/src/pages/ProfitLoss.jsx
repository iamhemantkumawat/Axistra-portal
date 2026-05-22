import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, KpiCard } from '../components/Atoms';
import { fmtMoney } from '../lib/format';
import { ChartLineUp, Receipt, Coins, Scales } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function ProfitLoss() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [yearly, setYearly] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [exp, setExp] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get(`/reports/yearly-pl?year=${year}`).then((r) => setYearly(r.data)),
      api.get(`/reports/monthly-sales?year=${year}`).then((r) => setMonthly(r.data.rows || [])),
      api.get('/reports/expenses').then((r) => setExp(r.data)),
    ]);
  }, [year]);

  if (!yearly || !exp) return <div className="text-gray-500">Loading…</div>;

  const chartData = monthly.map((m) => ({ month: m.month, sales: parseFloat(m.sales || 0) }));
  const categories = Object.entries(exp.by_category || {}).map(([k, v]) => ({ category: k, amount: v }));

  return (
    <div>
      <PageHeader
        eyebrow="Performance"
        title={`Profit & Loss — ${year}`}
        subtitle="Live yearly P&L with UAE Corporate Tax estimate at 9% above AED 375,000 threshold."
        actions={
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="input-axistra w-32" data-testid="pl-year-select">
            {[year + 1, year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}
          </select>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Total Sales" value={fmtMoney(yearly.total_sales)} icon={ChartLineUp} testId="pl-total-sales" />
        <KpiCard label="Total Expenses" value={fmtMoney(yearly.total_expenses)} icon={Receipt} testId="pl-total-expenses" />
        <KpiCard label="Gross Profit" value={fmtMoney(yearly.gross_profit)} accent icon={Coins} testId="pl-gross-profit" />
        <KpiCard label="Estimated Corp Tax (9%)" value={fmtMoney(yearly.estimated_corp_tax)} sub={`Net: ${fmtMoney(yearly.net_profit)}`} icon={Scales} testId="pl-corp-tax" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card-axistra p-6 lg:col-span-2" data-testid="pl-monthly-chart">
          <h3 className="font-display text-lg font-semibold mb-4">Monthly Sales — {year}</h3>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="month" stroke="#9CA3AF" fontSize={11} />
                <YAxis stroke="#9CA3AF" fontSize={11} />
                <Tooltip contentStyle={{ borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="sales" fill="#0A5C3E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-axistra p-6" data-testid="pl-expenses-by-category">
          <h3 className="font-display text-lg font-semibold mb-4">Expenses by Category</h3>
          <div className="space-y-3">
            {categories.length === 0 && <div className="text-sm text-gray-500">No expenses yet.</div>}
            {categories.map((c) => {
              const total = categories.reduce((s, x) => s + x.amount, 0);
              const pct = total > 0 ? (c.amount / total) * 100 : 0;
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{c.category}</span>
                    <span className="font-mono">{c.amount.toLocaleString()} AED</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-axistra-green" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
