import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge, KpiCard } from '../components/Atoms';
import { RECHARGE_STATUS_META, fmtNumber, fmtDate } from '../lib/format';
import { Link } from 'react-router-dom';
import { Wallet, Bank, Coin, Warning } from '@phosphor-icons/react';

export default function Treasury() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/treasury/reconciliation').then((r) => setData(r.data)); }, []);
  if (!data) return <div className="text-gray-500">Loading…</div>;

  return (
    <div>
      <PageHeader
        eyebrow="Treasury"
        title="Crypto Treasury & Reconciliation"
        subtitle="USDT receive → OKX → AED → Wio bank. Track every step of the chain."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <KpiCard label="Total Recharges" value={data.totals.total_recharges} icon={Coin} testId="treasury-kpi-total" />
        <KpiCard label="Fully Reconciled" value={data.totals.reconciled} icon={Bank} testId="treasury-kpi-reconciled" />
        <KpiCard label="Pending" value={data.totals.pending} icon={Wallet} testId="treasury-kpi-pending" />
        <KpiCard label="Mismatches" value={data.totals.mismatch} icon={Warning} accent testId="treasury-kpi-mismatch" />
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr><th>Recharge</th><th>Customer</th><th>Amount</th><th>USDT</th><th>OKX</th><th>AED</th><th>Wio</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {data.recharges.map((r) => {
              const t = r.treasury;
              return (
                <tr key={r.id} data-testid={`treasury-row-${r.recharge_code}`}>
                  <td className="font-mono text-axistra-green">{r.recharge_code}</td>
                  <td>{r.customer?.full_name || '—'}</td>
                  <td className="font-mono">{r.amount} {r.currency}</td>
                  <td className="font-mono text-xs">{fmtNumber(r.crypto_amount)}</td>
                  <td>{r.status === 'sent_to_okx' || r.status === 'converted_to_aed' || r.status === 'deposited_to_wio' || r.status === 'fully_reconciled' ? <Badge className="badge-success">Yes</Badge> : <Badge className="badge-neutral">—</Badge>}</td>
                  <td>{r.status === 'converted_to_aed' || r.status === 'deposited_to_wio' || r.status === 'fully_reconciled' ? <Badge className="badge-success">Yes</Badge> : <Badge className="badge-neutral">—</Badge>}</td>
                  <td>{r.status === 'deposited_to_wio' || r.status === 'fully_reconciled' ? <Badge className="badge-success">Yes</Badge> : <Badge className="badge-neutral">—</Badge>}</td>
                  <td><Badge className={RECHARGE_STATUS_META[r.status]?.cls}>{RECHARGE_STATUS_META[r.status]?.label}</Badge></td>
                  <td><Link to={`/recharges/${r.id}`} className="text-xs text-axistra-green hover:underline">Open →</Link></td>
                </tr>
              );
            })}
            {data.recharges.length === 0 && <tr><td colSpan="9" className="text-center text-gray-500 py-10">No treasury records yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
