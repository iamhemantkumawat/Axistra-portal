import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, Hash } from '../Atoms';
import { fmtMoney, fmtDate } from '../../lib/format';
import {
  fmtCrypto, fmtLedgerAmount, isReadyReceipt, rechargeFinalUsdt, inDateRange,
} from './utils';

/**
 * OxaPay tab — lists OxaPay USDT receipts plus auto-convert details for
 * each transaction. Includes expense outflows from the Expenses module.
 */
export function OxaPayTab({
  filterBar,
  receipts,
  readyReceipts,
  selectedIds,
  toggleReceipt,
  openBatch,
  walletBalance,
  expenseOutflows,
}) {
  const todayUsdt = receipts
    .filter((r) => inDateRange(r.payment_date || r.created_at, 'today'))
    .reduce((sum, r) => sum + rechargeFinalUsdt(r), 0);

  return (
    <>
      {filterBar}
      <div className="card-axistra overflow-x-auto">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-gray-200">
          <div>
            <div className="label-xs">Gateway Receipts</div>
            <div className="text-sm text-gray-600">OxaPay customer payments, original chain details, auto-conversion evidence, and final USDT received.</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="text-right">
              <div className="label-xs">OxaPay Wallet Balance</div>
              <div className="font-mono text-sm font-semibold text-axistra-green">
                {fmtCrypto(walletBalance)} USDT
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                Today received: {fmtCrypto(todayUsdt)} USDT
              </div>
            </div>
            <button onClick={openBatch} disabled={readyReceipts.length === 0} className="btn-primary disabled:opacity-50">
              Create USDT Transfer ({selectedIds.length || readyReceipts.length})
            </button>
          </div>
        </div>
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Batch</th><th>Recharge</th><th>Customer</th><th>Invoice</th><th>OxaPay Order</th>
              <th>TX Details</th><th>Final USDT</th><th>Treasury</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && <tr><td colSpan="8" className="text-center text-gray-500 py-10">No OxaPay receipts yet.</td></tr>}
            {receipts.map((r) => {
              const txs = r.crypto_transactions || [];
              const finalUsdt = rechargeFinalUsdt(r);
              const orderId = txs.find((tx) => tx.gateway_invoice_id)?.gateway_invoice_id;
              return (
                <tr key={r.id} data-testid={`oxapay-receipt-${r.recharge_code}`}>
                  <td>
                    {isReadyReceipt(r) && (
                      <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                    )}
                    {!isReadyReceipt(r) && r.treasury?.treasury_batch_id && <Badge className="badge-info">Batched</Badge>}
                  </td>
                  <td><Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link></td>
                  <td>
                    <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                    <div className="text-xs text-gray-500">{r.magnus_username}</div>
                  </td>
                  <td>
                    <div className="font-mono text-sm">{r.invoice_number || '—'}</div>
                    <div className="text-xs text-gray-500">{fmtMoney(r.amount, r.currency)}</div>
                  </td>
                  <td>
                    <div className="font-mono text-xs">{orderId || '—'}</div>
                    <div className="text-xs text-gray-500">{txs.length} transaction{txs.length === 1 ? '' : 's'}</div>
                  </td>
                  <td className="min-w-[360px] max-w-[440px]">
                    <div className="space-y-2">
                      {txs.length === 0 && <div className="text-xs text-gray-500">No detailed TX rows stored yet.</div>}
                      {txs.map((tx) => (
                        <div key={tx.id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 overflow-hidden">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-mono text-xs text-gray-900">
                              {fmtCrypto(tx.crypto_amount || tx.received_amount || tx.sent_amount)} {tx.coin} <span className="text-gray-400">{tx.network}</span>
                            </div>
                            <Badge className={String(tx.gateway_tx_status || '').toLowerCase() === 'confirmed' ? 'badge-success' : 'badge-warning'}>
                              {tx.gateway_tx_status || 'received'}
                            </Badge>
                          </div>
                          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600">
                            <div>Sent: <span className="font-mono">{tx.sent_amount || '—'}</span></div>
                            <div>Received: <span className="font-mono">{tx.received_amount || tx.received_value || '—'}</span></div>
                            <div className="md:col-span-2 min-w-0">Sender: <span className="font-mono break-all">{tx.sender_address || '—'}</span></div>
                            <div className="md:col-span-2 min-w-0">Wallet: <span className="font-mono break-all">{tx.receiving_wallet || '—'}</span></div>
                            <div>Auto convert: <span className="font-mono">{tx.auto_convert_amount || '0'} {tx.auto_convert_currency || ''}</span></div>
                            <div>Confirmations: <span className="font-mono">{tx.confirmations || '—'}</span></div>
                          </div>
                          <div className="mt-1"><Hash value={tx.tx_hash} /></div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="font-mono text-sm font-semibold text-axistra-green">
                    {finalUsdt ? `${fmtCrypto(finalUsdt)} USDT` : `${fmtCrypto(r.crypto_amount)} ${r.crypto_coin}`}
                  </td>
                  <td>
                    {r.treasury?.treasury_batch_id ? <Badge className="badge-info">Batched</Badge> : <Badge className="badge-warning">Ready</Badge>}
                    <div className="mt-1 text-xs text-gray-500">{r.treasury?.source_currency_summary || 'No summary'}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {expenseOutflows.length > 0 && (
          <div className="border-t border-gray-200 p-4">
            <div className="label-xs mb-2">OxaPay expense outflows from Expenses menu</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {expenseOutflows.map((e) => (
                <div key={e.id} className="rounded-md border border-gray-200 bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">{e.vendor_name}</div>
                      <div className="text-xs text-gray-500">{e.expense_code || e.category} · {fmtDate(e.expense_date)}</div>
                    </div>
                    <div className="font-mono text-sm text-red-700">-{fmtLedgerAmount(e.amount, e.currency)}</div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500"><Hash value={e.tx_hash} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
