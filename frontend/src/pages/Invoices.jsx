import React, { useEffect, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader } from '../components/Atoms';
import { fmtDate, fmtMoney, downloadBlob } from '../lib/format';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

export default function Invoices() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/invoices').then((r) => setItems(r.data)); }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Every recharge auto-generates a numbered invoice with Axistra FZCO footer and TX hash details."
      />
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr><th>Invoice #</th><th>Customer</th><th>Amount</th><th>Method</th><th>Status</th><th>Issued</th><th></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="7" className="text-center text-gray-500 py-10">Invoices will appear here once you create recharges.</td></tr>}
            {items.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.invoice_number}`}>
                <td className="font-mono font-medium text-axistra-green"><FileText size={14} className="inline mr-1" />{i.invoice_number}</td>
                <td>{i.customer_name}<div className="text-xs text-gray-500">{i.customer_email}</div></td>
                <td className="font-mono font-semibold">{fmtMoney(i.amount, i.currency)}</td>
                <td className="text-xs">{i.payment_method || '—'}</td>
                <td>
                  <span className={`badge ${i.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{i.status}</span>
                </td>
                <td className="text-xs text-gray-500">{fmtDate(i.issued_date)}</td>
                <td>
                  <button
                    onClick={() => downloadBlob(`${API_BASE}/invoices/${i.id}/pdf`, `${i.invoice_number}.pdf`)}
                    className="btn-secondary text-xs inline-flex items-center gap-1"
                    data-testid={`invoice-download-${i.invoice_number}`}
                  >
                    <DownloadSimple size={14} /> PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
