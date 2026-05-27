import React, { useState } from 'react';
import api from '../lib/api';
import { Link } from 'react-router-dom';
import { PageHeader, Badge, Hash, EmptyState } from '../components/Atoms';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { MagnifyingGlass, Receipt, Users, Wallet, Bank, FileText, ArrowsLeftRight } from '@phosphor-icons/react';

const TX_TYPE_LABEL = {
  deposit: 'Deposit', batch_out: 'Transfer Out', batch_in: 'Transfer In',
  convert_from: 'Convert From', convert_to: 'Convert To',
  cashout: 'Cashout', bank_deposit: 'Bank Deposit', expense: 'Expense', fee: 'Fee', adjustment: 'Adjustment',
};

const ChainNode = ({ icon: Icon, title, sub, done, children }) => (
  <div className="flex gap-3 mb-3">
    <div className="flex flex-col items-center">
      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${done ? 'bg-axistra-green text-white' : 'bg-gray-100 text-gray-400'}`}>
        <Icon size={18} weight="duotone" />
      </div>
      <div className="w-px flex-1 bg-gray-200 mt-1" />
    </div>
    <div className="flex-1 pb-2">
      <div className="font-display font-semibold text-gray-900">{title}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  </div>
);

export default function AuditChainSearch() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSearch = async (e) => {
    e?.preventDefault?.();
    if (!q || q.length < 3) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/chain/search?q=${encodeURIComponent(q)}`);
      setData(data);
    } finally { setLoading(false); }
  };

  const chain = data?.chain;

  return (
    <div data-testid="audit-chain-page">
      <PageHeader
        eyebrow="Compliance"
        title="Audit Chain Search"
        subtitle="Search by tx hash, batch code, invoice number, recharge code, customer code or magnus username and trace the full chain: Payment → Magnus → Conversion → Wio Deposit."
      />

      <form onSubmit={onSearch} className="card-axistra p-4 mb-6 flex flex-col md:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="audit-chain-input"
            autoFocus
            placeholder="Enter tx hash, batch code (BPAY-…), invoice, customer code, magnus username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input-axistra pl-10 w-full"
          />
        </div>
        <button data-testid="audit-chain-submit" type="submit" disabled={loading || q.length < 3} className="btn-primary disabled:opacity-50">{loading ? 'Searching…' : 'Search Chain'}</button>
      </form>

      {!data && !loading && (
        <EmptyState
          title="Trace any payment end-to-end"
          hint="Search by TX hash, batch code (e.g. BPAY-2605-00000), invoice number, customer email/code, or magnus username."
        />
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card-axistra p-6" data-testid="audit-chain-result">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="label-xs">Result</div>
                <h3 className="font-display text-xl font-semibold text-gray-900">"{data.query}"</h3>
              </div>
              <div className="text-right text-xs text-gray-500">
                {Object.entries(data.counts).map(([k, v]) => <span key={k} className="ml-2"><strong>{v}</strong> {k}</span>)}
              </div>
            </div>

            {chain ? (
              <div>
                <ChainNode icon={Users} title="Customer" done sub={chain.customer ? `${chain.customer.full_name} (${chain.customer.customer_code})` : '—'} />
                <ChainNode icon={FileText} title="Invoice" done={!!chain.invoice} sub={chain.invoice ? `${chain.invoice.invoice_number} · ${fmtMoney(chain.invoice.amount, chain.invoice.currency)}` : 'No invoice'} />
                <ChainNode icon={Receipt} title="Recharge" done={!!chain.recharge} sub={chain.recharge ? <Link to={`/recharges/${chain.recharge.id}`} className="text-axistra-green hover:underline">{chain.recharge.recharge_code}</Link> : ''}>
                  {chain.recharge && (
                    <div className="text-xs">
                      <div>Gateway: <strong>{chain.recharge.payment_gateway}</strong></div>
                      <div>Status: <Badge>{chain.recharge.status}</Badge></div>
                      <div className="mt-1">TX: <Hash value={chain.recharge.tx_hash} /></div>
                    </div>
                  )}
                </ChainNode>

                {(chain.ledger_entries || []).length > 0 && (
                  <ChainNode icon={Wallet} title="Wallet Ledger" done sub={`${chain.ledger_entries.length} entr${chain.ledger_entries.length === 1 ? 'y' : 'ies'}`}>
                    <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
                      {chain.ledger_entries.map((e) => {
                        const amt = parseFloat(e.amount || '0');
                        return (
                          <div key={e.id} className="p-3 text-xs grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-3 text-gray-500">{fmtDateTime(e.event_at)}</div>
                            <div className="col-span-2"><Badge>{TX_TYPE_LABEL[e.tx_type] || e.tx_type}</Badge></div>
                            <div className="col-span-2 font-mono">{e.wallet}</div>
                            <div className={`col-span-2 font-mono ${amt < 0 ? 'text-red-700' : 'text-axistra-green'}`}>{amt < 0 ? '' : '+'}{amt} {e.coin}</div>
                            <div className="col-span-3 font-mono text-gray-600">{e.external_ref || ''}</div>
                          </div>
                        );
                      })}
                    </div>
                  </ChainNode>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">No single chain matched. Browse partial matches in the right column.</div>
            )}
          </div>

          <div className="space-y-4">
            <SidePanel title="Recharges" icon={Receipt} count={data.recharges.length}>
              {data.recharges.slice(0, 6).map((r) => (
                <Link key={r.id} to={`/recharges/${r.id}`} className="block text-xs hover:underline">
                  <div className="font-mono text-axistra-green">{r.recharge_code}</div>
                  <div className="text-gray-500">{r.payment_gateway} · {r.magnus_username}</div>
                </Link>
              ))}
              {data.recharges.length === 0 && <div className="text-xs text-gray-400">None</div>}
            </SidePanel>
            <SidePanel title="Customers" icon={Users} count={data.customers.length}>
              {data.customers.slice(0, 6).map((c) => (
                <Link key={c.id} to={`/customers/${c.id}`} className="block text-xs hover:underline">
                  <div className="font-mono text-axistra-green">{c.customer_code}</div>
                  <div className="text-gray-700">{c.full_name}</div>
                </Link>
              ))}
              {data.customers.length === 0 && <div className="text-xs text-gray-400">None</div>}
            </SidePanel>
            <SidePanel title="Ledger entries" icon={ArrowsLeftRight} count={data.ledger.length}>
              {data.ledger.slice(0, 6).map((e) => (
                <div key={e.id} className="text-xs">
                  <div className="font-mono text-axistra-green">{e.wallet} · {TX_TYPE_LABEL[e.tx_type] || e.tx_type}</div>
                  <div className="text-gray-500">{e.external_ref || e.tx_hash?.slice(0, 16)}</div>
                </div>
              ))}
              {data.ledger.length === 0 && <div className="text-xs text-gray-400">None</div>}
            </SidePanel>
            <SidePanel title="Expenses" icon={Bank} count={data.expenses.length}>
              {data.expenses.slice(0, 6).map((e) => (
                <div key={e.id} className="text-xs">
                  <div className="font-mono text-axistra-green">{e.expense_code}</div>
                  <div className="text-gray-700">{e.vendor_name} · {e.amount} {e.currency}</div>
                </div>
              ))}
              {data.expenses.length === 0 && <div className="text-xs text-gray-400">None</div>}
            </SidePanel>
          </div>
        </div>
      )}
    </div>
  );
}

function SidePanel({ title, icon: Icon, count, children }) {
  return (
    <div className="card-axistra p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Icon size={16} weight="duotone" className="text-axistra-green" /><span className="font-display font-semibold text-gray-900">{title}</span></div>
        <Badge>{count}</Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
