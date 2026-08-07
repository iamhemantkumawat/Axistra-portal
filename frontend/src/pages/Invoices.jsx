import React, { useEffect, useMemo, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Modal } from '../components/Atoms';
import { fmtDate, downloadBlob } from '../lib/format';
import { DownloadSimple, FileText, Eye, Trash, MagnifyingGlass, X } from '@phosphor-icons/react';
import { toast } from 'sonner';

export default function Invoices() {
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [query, setQuery] = useState('');
  useEffect(() => { api.get('/invoices').then((r) => setItems(r.data)); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const bag = [
        i.invoice_number,
        i.customer_name,
        i.customer_email,
        i.magnus_username,
        i.customer_company,
      ].map((v) => String(v || '').toLowerCase());
      return bag.some((v) => v.includes(q));
    });
  }, [items, query]);

  const printPreview = () => {
    if (!preview?.html) return;
    const win = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=900');
    if (!win) return;
    win.document.open();
    win.document.write(preview.html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const previewInvoice = async (invoice) => {
    const token = localStorage.getItem('axistra_token');
    setLoadingId(invoice.id);
    try {
      const res = await fetch(`${API_BASE}/invoices/${invoice.id}/html`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Preview failed');
      const html = await res.text();
      setPreview({ id: invoice.id, name: `${invoice.invoice_number}.html`, html });
    } finally {
      setLoadingId(null);
    }
  };

  const downloadPdf = (invoice) => {
    downloadBlob(`${API_BASE}/invoices/${invoice.id}/pdf`, `${invoice.invoice_number}.pdf`);
  };

  const deleteInvoice = async (invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}?\n\nNote: invoices linked to a recharge can only be deleted via the recharge (it cascades the whole chain). This delete is for stand-alone invoices only.`)) return;
    try {
      await api.delete(`/invoices/${invoice.id}`);
      toast.success(`Deleted ${invoice.invoice_number}`);
      api.get('/invoices').then((r) => setItems(r.data));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Every recharge auto-generates a single-page A4 invoice with Axistra branding, payment trace and digital seal."
      />

      <div className="card-axistra p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by invoice #, customer name, email, or Magnus username…"
              className="input-axistra w-full pl-9 pr-9"
              data-testid="invoice-search-input"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                title="Clear"
                data-testid="invoice-search-clear"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500 whitespace-nowrap" data-testid="invoice-search-count">
            {filtered.length} of {items.length}
          </div>
        </div>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr><th>Invoice #</th><th>Customer</th><th>Magnus User</th><th>Amount (Source)</th><th>Total (AED)</th><th>Method</th><th>Status</th><th>Issued</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan="9" className="text-center text-gray-500 py-10">{items.length === 0 ? 'Invoices will appear here once you create recharges.' : 'No invoices match your search.'}</td></tr>}
            {filtered.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.invoice_number}`}>
                <td className="font-mono font-medium text-axistra-green"><FileText size={14} className="inline mr-1" />{i.invoice_number}</td>
                <td>{i.customer_name}<div className="text-xs text-gray-500">{i.customer_email}</div></td>
                <td className="font-mono text-xs">{i.magnus_username || '—'}</td>
                <td className="font-mono">{String(i.currency || 'USD').toUpperCase()} {parseFloat(i.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="font-mono font-semibold text-axistra-green">
                  AED {parseFloat(i.aed_total ?? i.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {i.aed_rate && String(i.currency).toUpperCase() !== 'AED' ? (
                    <div className="text-[10px] text-gray-500 font-normal">@ {Number(i.aed_rate).toFixed(4)}</div>
                  ) : null}
                </td>
                <td className="text-xs">{i.payment_method || '—'}</td>
                <td>
                  <span className={`badge ${i.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{i.status}</span>
                </td>
                <td className="text-xs text-gray-500">{fmtDate(i.issued_date)}</td>
                <td className="flex gap-1">
                  <button onClick={() => previewInvoice(i)} className="btn-secondary text-xs inline-flex items-center gap-1" title="Preview invoice" data-testid={`invoice-view-${i.invoice_number}`}>
                    <Eye size={14} /> {loadingId === i.id ? 'Loading…' : 'View'}
                  </button>
                  <button onClick={() => downloadPdf(i)} className="btn-secondary text-xs inline-flex items-center gap-1" data-testid={`invoice-download-${i.invoice_number}`}>
                    <DownloadSimple size={14} /> PDF
                  </button>
                  <button onClick={() => deleteInvoice(i)} className="btn-secondary text-xs inline-flex items-center gap-1 text-red-700 hover:bg-red-50 border-red-200" title="Delete invoice (standalone only)" data-testid={`invoice-delete-${i.invoice_number}`}>
                    <Trash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || 'Invoice Preview'} testId="invoice-preview-modal" size="xl">
        <div className="flex justify-end gap-2 mb-4">
          <button onClick={printPreview} className="btn-secondary inline-flex items-center gap-2" data-testid="invoice-preview-print">
            <Eye size={16} /> Print
          </button>
          <button
            onClick={() => preview && downloadBlob(`${API_BASE}/invoices/${preview.id}/pdf`, preview.name.replace('.html', '.pdf'))}
            className="btn-primary inline-flex items-center gap-2"
            data-testid="invoice-preview-download"
          >
            <DownloadSimple size={16} /> Download PDF
          </button>
        </div>
        <iframe title={preview?.name} srcDoc={preview?.html || ''} className="w-full h-[78vh] rounded border border-gray-200 bg-white" />
      </Modal>
    </div>
  );
}
