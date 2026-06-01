import React, { useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge, Field, Modal } from '../components/Atoms';
import { toast } from 'sonner';
import { CloudArrowUp, FilePdf, Image as ImageIcon, DownloadSimple, Pencil, Trash, FileText, ShieldCheck, Buildings, IdentificationCard, Receipt, Certificate, Bank, Warning } from '@phosphor-icons/react';

const DOC_TYPES = [
  { value: 'trade_license', label: 'Trade License', icon: Buildings },
  { value: 'moa', label: 'Memorandum of Association (MOA)', icon: FileText },
  { value: 'aoa', label: 'Articles of Association (AOA)', icon: FileText },
  { value: 'share_certificate', label: 'Share Certificate', icon: Certificate },
  { value: 'trn_certificate', label: 'TRN / VAT Certificate', icon: Receipt },
  { value: 'lease', label: 'Lease / Tenancy Contract', icon: Buildings },
  { value: 'board_resolution', label: 'Board Resolution', icon: ShieldCheck },
  { value: 'shareholder_resolution', label: 'Shareholder Resolution', icon: ShieldCheck },
  { value: 'cof', label: 'Certificate of Formation (COF)', icon: Certificate },
  { value: 'poa', label: 'Power of Attorney (POA)', icon: ShieldCheck },
  { value: 'bank_letter', label: 'Bank Letter / GIBAN', icon: Bank },
  { value: 'other', label: 'Other', icon: FileText },
];

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
}

function expiryBadge(d) {
  const days = daysUntil(d);
  if (days === null) return null;
  if (days < 0) return <Badge className="badge-error">Expired {Math.abs(days)}d ago</Badge>;
  if (days <= 30) return <Badge className="badge-warning">Expires in {days}d</Badge>;
  if (days <= 90) return <Badge className="badge-info">Expires in {days}d</Badge>;
  return <Badge className="badge-success">Valid · {days}d left</Badge>;
}

export default function CorporateDocs() {
  const [docs, setDocs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [filter, setFilter] = useState('all');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [form, setForm] = useState({
    title: '', doc_type: 'trade_license', reference_number: '',
    issuing_authority: '', issued_at: '', expires_at: '', notes: '',
  });
  const fileRef = useRef(null);

  const load = () => api.get('/corporate-docs').then((r) => setDocs(r.data));
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ title: '', doc_type: 'trade_license', reference_number: '', issuing_authority: '', issued_at: '', expires_at: '', notes: '' });
    setEditDoc(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editDoc) {
        await api.patch(`/corporate-docs/${editDoc.id}`, form);
        toast.success('Document updated');
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) { toast.error('Please choose a file'); return; }
        const fd = new FormData();
        fd.append('file', file);
        Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
        await api.post('/corporate-docs', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Document uploaded');
      }
      setShowForm(false); resetForm(); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    }
  };

  const onEdit = (d) => {
    setEditDoc(d);
    setForm({
      title: d.title || '', doc_type: d.doc_type || 'other',
      reference_number: d.reference_number || '', issuing_authority: d.issuing_authority || '',
      issued_at: d.issued_at ? d.issued_at.slice(0, 10) : '',
      expires_at: d.expires_at ? d.expires_at.slice(0, 10) : '',
      notes: d.notes || '',
    });
    setShowForm(true);
  };

  const onDelete = async (d) => {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    try { await api.delete(`/corporate-docs/${d.id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  };

  const fetchDocBlob = async (d) => {
    const token = localStorage.getItem('axistra_token');
    const fname = d.file_url.split('/').slice(-2)[0];
    const res = await fetch(`${API_BASE}/corporate-docs/${fname}/file`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Could not load document');
    return res.blob();
  };

  const onPreview = async (d) => {
    try {
      const blob = await fetchDocBlob(d);
      setPreviewDoc({ name: d.file_name, type: blob.type, url: URL.createObjectURL(blob) });
    } catch (err) { toast.error(err.message); }
  };

  const onDownload = async (d) => {
    const blob = await fetchDocBlob(d);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = d.file_name; a.click();
  };

  const filtered = filter === 'all' ? docs : docs.filter((d) => d.doc_type === filter);
  const stats = {
    total: docs.length,
    expiring: docs.filter((d) => d.expires_at && daysUntil(d.expires_at) <= 90 && daysUntil(d.expires_at) >= 0).length,
    expired: docs.filter((d) => d.expires_at && daysUntil(d.expires_at) < 0).length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Vault"
        title="Corporate Documents"
        subtitle="Centralised vault for Trade License, MOA, TRN, Board Resolutions and other official company paperwork."
        actions={<button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary" data-testid="corp-doc-add-btn">+ Upload Document</button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="card-axistra p-4" data-testid="corp-doc-stat-total">
          <div className="label-xs">Total Documents</div>
          <div className="font-display text-2xl font-bold mt-1">{stats.total}</div>
        </div>
        <div className="card-axistra p-4" data-testid="corp-doc-stat-expiring">
          <div className="label-xs">Expiring within 90 days</div>
          <div className="font-display text-2xl font-bold mt-1 text-amber-600">{stats.expiring}</div>
        </div>
        <div className="card-axistra p-4" data-testid="corp-doc-stat-expired">
          <div className="label-xs">Expired</div>
          <div className="font-display text-2xl font-bold mt-1 text-red-600">{stats.expired}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-[var(--axistra-green)] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} data-testid="corp-doc-filter-all">All ({docs.length})</button>
        {DOC_TYPES.map((t) => {
          const count = docs.filter((d) => d.doc_type === t.value).length;
          if (!count) return null;
          return (
            <button key={t.value} onClick={() => setFilter(t.value)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === t.value ? 'bg-[var(--axistra-green)] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full card-axistra p-10 text-center text-gray-500">
            <FileText size={42} weight="duotone" className="mx-auto text-gray-400" />
            <div className="mt-2">No documents yet. Click "Upload Document" to add one.</div>
          </div>
        )}
        {filtered.map((d) => {
          const meta = DOC_TYPES.find((t) => t.value === d.doc_type) || DOC_TYPES[DOC_TYPES.length - 1];
          const Icon = meta.icon;
          const isPdf = d.file_name?.toLowerCase().endsWith('.pdf');
          return (
            <div key={d.id} className="card-axistra p-5 flex flex-col" data-testid={`corp-doc-card-${d.id}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[var(--axistra-green-light)] text-axistra-green flex items-center justify-center shrink-0">
                    <Icon size={20} weight="duotone" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm truncate">{d.title}</div>
                    <div className="text-[11px] text-gray-500">{meta.label}</div>
                  </div>
                </div>
                {expiryBadge(d.expires_at)}
              </div>

              <div className="space-y-1.5 text-xs text-gray-700 mb-3">
                {d.reference_number && <div><span className="text-gray-500">Ref:</span> <span className="font-mono">{d.reference_number}</span></div>}
                {d.issuing_authority && <div><span className="text-gray-500">Authority:</span> {d.issuing_authority}</div>}
                <div><span className="text-gray-500">Issued:</span> {fmt(d.issued_at)} · <span className="text-gray-500">Expires:</span> {fmt(d.expires_at)}</div>
                {d.notes && <div className="text-gray-600 italic line-clamp-2">"{d.notes}"</div>}
              </div>

              <div className="mt-auto flex items-center gap-2 pt-3 border-t border-gray-100">
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-600 truncate flex-1">
                  {isPdf ? <FilePdf size={14} className="text-red-600 shrink-0" /> : <ImageIcon size={14} className="text-axistra-green shrink-0" />}
                  <span className="truncate">{d.file_name}</span>
                </span>
                <button onClick={() => onPreview(d)} className="text-xs text-axistra-green hover:underline" data-testid={`corp-doc-view-${d.id}`}>View</button>
                <button onClick={() => onDownload(d)} className="text-xs text-axistra-green hover:underline" data-testid={`corp-doc-download-${d.id}`}><DownloadSimple size={14} /></button>
                <button onClick={() => onEdit(d)} className="text-xs text-gray-500 hover:text-axistra-green" data-testid={`corp-doc-edit-${d.id}`}><Pencil size={14} /></button>
                <button onClick={() => onDelete(d)} className="text-xs text-red-500 hover:text-red-700" data-testid={`corp-doc-delete-${d.id}`}><Trash size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title={editDoc ? 'Edit Document Metadata' : 'Upload Corporate Document'} testId="corp-doc-modal" size="lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title *">
            <input required className="input-axistra" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Trade License 2026 – IFZA" data-testid="corp-doc-title" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Document Type *">
              <select required className="input-axistra" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} data-testid="corp-doc-type">
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Reference Number">
              <input className="input-axistra" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} placeholder="e.g. License 105415" />
            </Field>
            <Field label="Issuing Authority">
              <input className="input-axistra" value={form.issuing_authority} onChange={(e) => setForm({ ...form, issuing_authority: e.target.value })} placeholder="IFZA / FTA / Notary…" />
            </Field>
            <Field label="Issued Date">
              <input type="date" className="input-axistra" value={form.issued_at} onChange={(e) => setForm({ ...form, issued_at: e.target.value })} />
            </Field>
            <Field label="Expiry Date">
              <input type="date" className="input-axistra" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea rows={3} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {!editDoc && (
            <Field label="File * (PDF, PNG, JPG, DOCX — max 25 MB)">
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className="block w-full text-sm" data-testid="corp-doc-file" />
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="corp-doc-save">{editDoc ? 'Save' : 'Upload'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!previewDoc} onClose={() => setPreviewDoc(null)} title={previewDoc?.name || ''} size="xl">
        {previewDoc?.type?.includes('pdf') ? (
          <iframe title={previewDoc.name} src={previewDoc.url} className="w-full h-[75vh] rounded border border-gray-200" />
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <img src={previewDoc?.url} alt={previewDoc?.name} className="max-h-[75vh] mx-auto object-contain" />
          </div>
        )}
      </Modal>
    </div>
  );
}
