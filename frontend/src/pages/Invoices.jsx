import React, { useEffect, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Modal } from '../components/Atoms';
import { fmtDate, downloadBlob } from '../lib/format';
import { useCurrency } from '../lib/currency';
import { DownloadSimple, FileText, Eye, PaintBrush } from '@phosphor-icons/react';

export default function Invoices() {
  const [items, setItems] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [style, setStyle] = useState(() => localStorage.getItem('axistra_invoice_style') || 'minimal');
  const { format } = useCurrency();
  useEffect(() => { api.get('/invoices').then((r) => setItems(r.data)); }, []);
  useEffect(() => { localStorage.setItem('axistra_invoice_style', style); }, [style]);

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

  const previewInvoice = async (invoice, variantOverride) => {
    const token = localStorage.getItem('axistra_token');
    const variant = variantOverride || style;
    setLoadingId(invoice.id);
    try {
      const res = await fetch(`${API_BASE}/invoices/${invoice.id}/html?style=${variant}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Preview failed');
      const html = await res.text();
      setPreview({ id: invoice.id, variant, name: `${invoice.invoice_number}-${variant}.html`, html });
    } finally {
      setLoadingId(null);
    }
  };

  const downloadPdf = (invoice, variantOverride) => {
    const variant = variantOverride || style;
    downloadBlob(`${API_BASE}/invoices/${invoice.id}/pdf?style=${variant}`, `${invoice.invoice_number}-${variant}.pdf`);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Every recharge auto-generates a numbered invoice with Axistra FZCO footer and TX hash details."
        actions={(
          <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1" data-testid="invoice-style-toggle">
            <PaintBrush size={14} className="text-axistra-green" />
            <span className="text-[11px] uppercase tracking-wider text-gray-500">Template</span>
            <button
              data-testid="invoice-style-branded"
              onClick={() => setStyle('branded')}
              className={`text-xs px-3 py-1 rounded ${style === 'branded' ? 'bg-axistra-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >Branded</button>
            <button
              data-testid="invoice-style-minimal"
              onClick={() => setStyle('minimal')}
              className={`text-xs px-3 py-1 rounded ${style === 'minimal' ? 'bg-axistra-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >Minimal</button>
          </div>
        )}
      />
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr><th>Invoice #</th><th>Customer</th><th>Amount</th><th>Method</th><th>Status</th><th>Issued</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="7" className="text-center text-gray-500 py-10">Invoices will appear here once you create recharges.</td></tr>}
            {items.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.invoice_number}`}>
                <td className="font-mono font-medium text-axistra-green"><FileText size={14} className="inline mr-1" />{i.invoice_number}</td>
                <td>{i.customer_name}<div className="text-xs text-gray-500">{i.customer_email}</div></td>
                <td className="font-mono font-semibold">{format(i.amount, i.currency)}</td>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || 'Invoice Preview'} testId="invoice-preview-modal" size="xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1" data-testid="invoice-preview-style-toggle">
            <span className="text-[11px] uppercase tracking-wider text-gray-500">Compare</span>
            <button
              onClick={() => preview && previewInvoice({ id: preview.id, invoice_number: preview.name.split('-')[0] }, 'branded')}
              className={`text-xs px-3 py-1 rounded ${preview?.variant === 'branded' ? 'bg-axistra-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              data-testid="invoice-preview-branded"
            >Branded Hero</button>
            <button
              onClick={() => preview && previewInvoice({ id: preview.id, invoice_number: preview.name.split('-')[0] }, 'minimal')}
              className={`text-xs px-3 py-1 rounded ${preview?.variant === 'minimal' ? 'bg-axistra-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              data-testid="invoice-preview-minimal"
            >Premium Minimal</button>
          </div>
          <div className="flex gap-2">
            <button onClick={printPreview} className="btn-secondary inline-flex items-center gap-2">
              <Eye size={16} /> Print
            </button>
            <button
              onClick={() => preview && downloadBlob(`${API_BASE}/invoices/${preview.id}/pdf?style=${preview.variant}`, preview.name.replace('.html', '.pdf'))}
              className="btn-primary inline-flex items-center gap-2"
            >
              <DownloadSimple size={16} /> Download PDF
            </button>
          </div>
        </div>
        <iframe title={preview?.name} srcDoc={preview?.html || ''} className="w-full h-[75vh] rounded border border-gray-200 bg-white" />
      </Modal>
    </div>
  );
}
