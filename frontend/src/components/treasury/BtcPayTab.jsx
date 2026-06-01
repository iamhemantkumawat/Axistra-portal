import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, Hash } from '../Atoms';
import { RECHARGE_STATUS_META, fmtMoney, fmtDate } from '../../lib/format';
import { fmtCrypto, isReadyReceipt, safeJson, inDateRange } from './utils';

/**
 * BTCPay tab — lists BTC customer payments along with batching controls.
 * Shape of the prop bag is exactly the slice of Treasury state this tab
 * touches; nothing more, nothing less.
 */
export function BtcPayTab({
  filterBar,
  receipts,
  readyReceipts,
  selectedIds,
  toggleReceipt,
  openBatch,
  verifyReceipt,
  verifyingId,
  walletBalance,
}) {
  const todayReceived = receipts
    .filter((r) => inDateRange(r.payment_date || r.created_at, 'today'))
    .reduce((sum, r) => sum + parseFloat(r.crypto_amount || '0'), 0);

  return (
    <>
      {filterBar}
      <div className="card-axistra overflow-x-auto">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-gray-200">
          <div>
            <div className="label-xs">Gateway Receipts</div>
            <div className="text-sm text-gray-600">BTCPay BTC customer payments, destination wallet evidence, mempool verification, and daily/weekly BTC transfer records.</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="text-right">
              <div className="label-xs">BTCPay Wallet Balance</div>
              <div className="font-mono text-sm font-semibold text-axistra-green">
                {fmtCrypto(walletBalance)} BTC
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                Today received: {fmtCrypto(todayReceived)} BTC
              </div>
            </div>
            <button onClick={openBatch} disabled={readyReceipts.length === 0} className="btn-primary disabled:opacity-50">
              Create BTC Transfer ({selectedIds.length || readyReceipts.length})
            </button>
          </div>
        </div>
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Batch</th><th>Recharge</th><th>Customer</th><th>Invoice Amount</th><th>BTC Payment</th>
              <th>Destination Wallet</th><th>Sender / Inputs</th><th>TX Hash</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && <tr><td colSpan="10" className="text-center text-gray-500 py-10">No BTCPay receipts yet.</td></tr>}
            {receipts.map((r) => {
              const txs = r.crypto_transactions || [];
              const primaryTx = txs[0] || {};
              const raw = safeJson(primaryTx.raw_gateway_payload);
              const paymentId = raw?.payment?.id || raw?.payment_id;
              return (
                <tr key={r.id} data-testid={`btcpay-receipt-${r.recharge_code}`}>
                  <td>
                    {isReadyReceipt(r) && (
                      <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                    )}
                    {!isReadyReceipt(r) && r.treasury?.treasury_batch_id && <Badge className="badge-info">Batched</Badge>}
                  </td>
                  <td>
                    <Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link>
                    <div className="text-xs text-gray-500">{fmtDate(r.payment_date)}</div>
                  </td>
                  <td>
                    <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                    <div className="text-xs text-gray-500">{r.magnus_username}</div>
                  </td>
                  <td>
                    <div className="font-mono">{fmtMoney(r.amount, r.currency)}</div>
                    <div className="text-xs text-gray-500">{r.invoice_number || '—'}</div>
                  </td>
                  <td>
                    <div className="font-mono text-sm">{fmtCrypto(r.crypto_amount)} BTC</div>
                    <div className="text-xs text-gray-500">{txs.length} BTC tx{txs.length === 1 ? '' : 's'}</div>
                  </td>
                  <td className="font-mono text-xs max-w-[220px] truncate">{primaryTx.receiving_wallet || r.wallet_address || '—'}</td>
                  <td className="font-mono text-xs max-w-[220px] truncate">
                    {primaryTx.sender_address || 'Verify with mempool'}
                  </td>
                  <td>
                    <Hash value={primaryTx.tx_hash || r.tx_hash} />
                    {paymentId && <div className="mt-1 text-[11px] text-gray-500">BTCPay payment: <span className="font-mono">{String(paymentId).slice(0, 18)}...</span></div>}
                    {raw?.afterExpiration && <div className="mt-1"><Badge className="badge-warning">After expiration</Badge></div>}
                  </td>
                  <td>
                    <Badge className={primaryTx.gateway_tx_status === 'confirmed' ? 'badge-success' : RECHARGE_STATUS_META[r.status]?.cls}>
                      {primaryTx.gateway_tx_status || RECHARGE_STATUS_META[r.status]?.label || r.status}
                    </Badge>
                    <div className="mt-1 text-xs text-gray-500">{primaryTx.confirmations ? `${primaryTx.confirmations} confirmation(s)` : 'No mempool check'}</div>
                  </td>
                  <td className="text-right">
                    <button onClick={() => verifyReceipt(r.id)} disabled={verifyingId === r.id || !primaryTx.tx_hash} className="btn-secondary text-xs disabled:opacity-50">
                      {verifyingId === r.id ? 'Verifying...' : 'Verify'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
