import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, Hash } from '../Atoms';
import { RECHARGE_STATUS_META, fmtMoney } from '../../lib/format';
import { fmtCrypto } from './utils';

/**
 * "Payment Receipts" tab — minimal table of recharges that are ready to be
 * batched into a treasury transfer. Purely presentational: the parent owns
 * the filter bar and the data, this tab just renders rows.
 */
export function ReceiptsTab({ filterBar, receipts }) {
  return (
    <>
      {filterBar}
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Recharge</th><th>Customer</th><th>Gateway / Wallet</th><th>Invoice Amount</th><th>Crypto Paid</th><th>Customer TXID</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && <tr><td colSpan="7" className="text-center text-gray-500 py-10">No ready customer receipts. Use each source tab to create the correct transfer or conversion record.</td></tr>}
            {receipts.map((r) => (
              <tr key={r.id} data-testid={`ready-receipt-${r.recharge_code}`}>
                <td><Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link></td>
                <td>
                  <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                  <div className="text-xs text-gray-500">{r.customer?.customer_code || r.magnus_username}</div>
                </td>
                <td>
                  <Badge className="badge-neutral">{r.payment_gateway || 'Manual'}</Badge>
                  <div className="mt-1 text-xs text-gray-500">{r.treasury?.receiving_wallet_tag || r.treasury?.receiving_wallet || r.wallet_address || '—'}</div>
                </td>
                <td className="font-mono">{fmtMoney(r.amount, r.currency)}</td>
                <td className="font-mono text-xs">{fmtCrypto(r.crypto_amount)} {r.crypto_coin} <span className="text-gray-400">{r.crypto_network}</span></td>
                <td><Hash value={r.tx_hash} /></td>
                <td><Badge className={RECHARGE_STATUS_META[r.status]?.cls}>{RECHARGE_STATUS_META[r.status]?.label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
