import React, { useEffect, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader } from '../components/Atoms';
import { useCurrency } from '../lib/currency';
import { ShieldWarning, FilePdf } from '@phosphor-icons/react';
import {
  ResponsiveContainer, Tooltip, CartesianGrid, AreaChart, Area, XAxis, YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { RevenueRow, ObligationsRow, TreasuryRow, PostureRow } from '../components/dashboard/KpiRows';

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [chart, setChart] = useState([]);
  const [recent, setRecent] = useState({ recharges: [], compliance: [] });
  const [topCustomers, setTopCustomers] = useState([]);
  const [exporting, setExporting] = useState(false);
  const { format } = useCurrency();

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/kpis').then((r) => setKpis(r.data)),
      api.get('/dashboard/chart').then((r) => setChart(r.data)),
      api.get('/dashboard/recent').then((r) => setRecent(r.data)),
      api.get('/dashboard/top-customers').then((r) => setTopCustomers(r.data)).catch(() => {}),
    ]);
  }, []);

  const exportNetWorthPdf = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('axistra_token');
      const res = await fetch(`${API_BASE}/dashboard/net-worth/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `Axistra-Net-Worth-${new Date().toISOString().slice(0, 10)}.pdf`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      toast.success('Net Worth statement downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!kpis) return <div className="text-gray-500 p-6">Loading dashboard…</div>;

  const chartData = chart.map((c) => ({ month: c.month, sales: c.sales_aed, count: c.count }));

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        eyebrow="Live performance · AED canonical"
        title="Dashboard"
        subtitle="Real-time view of recharges (FX-converted to AED), treasury flow, payroll due, invoices and compliance posture."
        actions={
          <button
            onClick={exportNetWorthPdf}
            disabled={exporting}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
            data-testid="dashboard-export-net-worth-btn"
          >
            <FilePdf size={18} weight="duotone" />
            {exporting ? 'Generating…' : 'Export Net Worth PDF'}
          </button>
        }
      />

      <RevenueRow kpis={kpis} format={format} />
      <ObligationsRow kpis={kpis} format={format} />
      <TreasuryRow kpis={kpis} format={format} />
      <PostureRow kpis={kpis} format={format} />

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
