import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge, KpiCard } from '../components/Atoms';
import { Link } from 'react-router-dom';
import { CurrencyCircleDollar, Bank, ArrowRight, CheckCircle, Clock, Wallet, Receipt, Database, Hourglass } from '@phosphor-icons/react';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtAed = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—');

function ChainStep({ icon: Icon, title, ok, pending, sub, children }) {
  const cls = ok
    ? 'border-green-300 bg-green-50'
    : pending
      ? 'border-amber-200 bg-amber-50'
      : 'border-gray-200 bg-gray-50';
  const iconCls = ok ? 'text-green-700 bg-green-100' : pending ? 'text-amber-700 bg-amber-100' : 'text-gray-500 bg-gray-100';
  return (
    <div className={`flex-1 min-w-[180px] border rounded-lg p-3 ${cls}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${iconCls}`}>
          <Icon size={14} weight="bold" />
        </div>
        <div className="font-medium text-xs">{title}</div>
      </div>
      {sub && <div className="text-[10px] text-gray-500 mb-1">{sub}</div>}
      <div className="text-xs text-gray-700 space-y-0.5">{children}</div>
    </div>
  );
}

export default function ConversionRegister() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState({ from: '', to: '', status: '', currency: '' });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filter).forEach(([k, v]) => v && params.append(k, v));
      const [r, s] = await Promise.all([
        api.get(`/conversion-register?${params}`),
        api.get(`/conversion-register/summary?${params}`),
      ]);
      setRows(r.data); setSummary(s.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Source of Funds"
        title="Crypto Conversion Register"
        subtitle="End-to-end audit trail: Customer → Invoice → Crypto TX → Exchange → AED Conversion → Wio Bank Deposit. Read-only report aggregated from existing data."
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-5">
        <KpiCard label="Total Chains" value={summary.total_chains || 0} icon={Database} testId="cr-kpi-total" />
        <KpiCard label="Fully Reconciled" value={summary.fully_reconciled || 0} icon={CheckCircle} testId="cr-kpi-reconciled" />
        <KpiCard label="In Exchange" value={summary.pending_in_exchange || 0} icon={Hourglass} testId="cr-kpi-exchange" />
        <KpiCard label="Pending Sweep" value={summary.pending_sweep || 0} icon={Clock} testId="cr-kpi-sweep" />
        <KpiCard label="Gross AED" value={fmtAed(summary.total_gross_aed)} icon={CurrencyCircleDollar} testId="cr-kpi-gross" />
        <KpiCard label="Net AED to Bank" value={fmtAed(summary.total_net_aed)} icon={Bank} testId="cr-kpi-net" accent />
      </div>

      <div className="card-axistra p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="label-xs block mb-1">From</label>
            <input type="date" className="input-axistra" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} data-testid="cr-filter-from" />
          </div>
          <div>
            <label className="label-xs block mb-1">To</label>
            <input type="date" className="input-axistra" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} data-testid="cr-filter-to" />
          </div>
          <div>
            <label className="label-xs block mb-1">Currency</label>
            <select className="input-axistra" value={filter.currency} onChange={(e) => setFilter({ ...filter, currency: e.target.value })}>
              <option value="">All</option><option>USD</option><option>EUR</option><option>AED</option>
            </select>
          </div>
          <div>
            <label className="label-xs block mb-1">Status</label>
            <select className="input-axistra" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              <option value="pending_payment">Pending Payment</option>
              <option value="payment_received">Payment Received</option>
              <option value="magnus_credited">Magnus Credited</option>
              <option value="converted_to_aed">Converted to AED</option>
              <option value="fully_reconciled">Fully Reconciled</option>
            </select>
          </div>
          <button onClick={load} className="btn-primary" data-testid="cr-apply">{loading ? 'Loading…' : 'Apply Filters'}</button>
        </div>
      </div>

      <div className="space-y-4">
        {rows.length === 0 && (
          <div className="card-axistra p-10 text-center text-gray-500">
            No conversion chains match your filters.
          </div>
        )}
        {rows.map((c) => (
          <div key={c.recharge_id} className="card-axistra p-5" data-testid={`cr-row-${c.recharge_id}`}>
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <Link to={`/recharges/${c.recharge_id}`} className="font-mono text-sm font-semibold text-axistra-green hover:underline">
                  {c.recharge_code}
                </Link>
                <Badge className={c.wio_deposit ? 'badge-success' : 'badge-info'}>{c.status}</Badge>
                <span className="text-xs text-gray-500">{fmt(c.created_at)}</span>
              </div>
              <div className="text-right text-xs">
                <div className="text-gray-500">Net to Wio</div>
                <div className="font-display text-base font-bold text-axistra-green">
                  {c.wio_deposit ? fmtAed(c.wio_deposit.net_amount) : '—'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <ChainStep icon={Receipt} title="1. Customer" ok={!!c.customer} sub={c.customer?.code}>
                <div className="font-medium">{c.customer?.name || '—'}</div>
                <div className="text-gray-500">{c.customer?.country || ''}</div>
                {c.customer?.magnus_username && <div className="text-[10px] font-mono">@{c.customer.magnus_username}</div>}
              </ChainStep>

              <ChainStep icon={Receipt} title="2. Invoice" ok={!!c.invoice} pending={!c.invoice}>
                <div className="font-mono text-[11px]">{c.invoice?.number || 'No invoice'}</div>
                <div>{c.invoice ? `${c.invoice.currency} ${c.invoice.amount}` : '—'}</div>
                {c.invoice && <Badge className={c.invoice.status === 'paid' ? 'badge-success' : 'badge-warning'}>{c.invoice.status}</Badge>}
              </ChainStep>

              <ChainStep icon={Wallet} title="3. Crypto TX" ok={!!c.crypto_receipt?.tx_hash} pending={!c.crypto_receipt?.tx_hash}>
                <div>{c.crypto_receipt.amount} {c.crypto_receipt.coin}</div>
                <div className="text-[10px] text-gray-500">{c.crypto_receipt.payment_gateway} · {c.crypto_receipt.network}</div>
                <div className="font-mono text-[10px]">{shortHash(c.crypto_receipt.tx_hash)}</div>
              </ChainStep>

              <ChainStep icon={Bank} title="4. Exchange" ok={!!c.exchange_settlement} pending={!c.exchange_settlement && !!c.crypto_receipt?.tx_hash}>
                {c.exchange_settlement ? (
                  <>
                    <div>{c.exchange_settlement.destination_exchange}</div>
                    <div className="text-[10px] text-gray-500">Batch {c.exchange_settlement.batch_code}</div>
                    <div className="text-[10px]">{c.exchange_settlement.received_amount} received</div>
                  </>
                ) : <div className="text-gray-400">Not swept</div>}
              </ChainStep>

              <ChainStep icon={ArrowRight} title="5. USDT Convert" ok={!!c.usdt_conversion}>
                {c.usdt_conversion ? (
                  <>
                    <div>{c.usdt_conversion.usdt_amount} USDT</div>
                    <div className="text-[10px] text-gray-500">Rate {c.usdt_conversion.rate}</div>
                    <div className="text-[10px]">{fmt(c.usdt_conversion.date)}</div>
                  </>
                ) : <div className="text-gray-400">—</div>}
              </ChainStep>

              <ChainStep icon={CurrencyCircleDollar} title="6. AED Sale" ok={!!c.fiat_conversion}>
                {c.fiat_conversion ? (
                  <>
                    <div className="font-semibold">{c.fiat_conversion.fiat_currency} {Number(c.fiat_conversion.fiat_received).toLocaleString()}</div>
                    <div className="text-[10px] text-gray-500">@ {c.fiat_conversion.rate}</div>
                    <div className="text-[10px]">{fmt(c.fiat_conversion.date)}</div>
                  </>
                ) : <div className="text-gray-400">—</div>}
              </ChainStep>

              <ChainStep icon={Bank} title="7. Wio Deposit" ok={!!c.wio_deposit}>
                {c.wio_deposit ? (
                  <>
                    <div className="font-semibold text-green-700">{fmtAed(c.wio_deposit.net_amount)}</div>
                    <div className="text-[10px] font-mono">{c.wio_deposit.reference}</div>
                    <div className="text-[10px]">{fmt(c.wio_deposit.deposit_date)}</div>
                  </>
                ) : <div className="text-gray-400">—</div>}
              </ChainStep>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
