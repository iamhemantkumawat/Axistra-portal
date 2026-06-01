import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge, Field, Modal } from '../components/Atoms';
import { RISK_META, KYC_META, CUSTOMER_STATUS_META, fmtDate, fmtDateTime } from '../lib/format';
import { COUNTRIES } from '../lib/countries';
import { toast } from 'sonner';
import { CloudArrowUp, FilePdf, Image as ImageIcon, CheckCircle, XCircle, DownloadSimple, Trash } from '@phosphor-icons/react';

const DOC_TYPES = [
  { value: 'passport', label: 'Passport / National ID' },
  { value: 'company_doc', label: 'Company Document' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'source_of_funds', label: 'Source of Funds' },
  { value: 'other', label: 'Other' },
];

const STATUS_META = {
  submitted: 'badge-info',
  approved: 'badge-success',
  rejected: 'badge-error',
};

export default function CustomerDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  const [docType, setDocType] = useState('passport');
  const [uploading, setUploading] = useState(false);
  const [reviewDoc, setReviewDoc] = useState(null);
  const [reviewComment, setReviewComment] = useState('');
  const [docPreview, setDocPreview] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.get(`/customers/${id}`).then((r) => { setC(r.data); setForm(r.data); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!c) return <div className="text-gray-500">Loading…</div>;

  const save = async () => {
    try {
      await api.patch(`/customers/${id}`, form);
      toast.success('Customer updated');
      setEdit(false); load();
    } catch { toast.error('Update failed'); }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const oversized = files.find((f) => f.size > 10 * 1024 * 1024);
    if (oversized) { toast.error(`"${oversized.name}" exceeds 10 MB`); return; }
    setUploading(true);
    try {
      if (files.length === 1) {
        const fd = new FormData();
        fd.append('file', files[0]);
        fd.append('document_type', docType);
        await api.post(`/kyc/${id}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Document uploaded');
      } else {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        fd.append('document_type', docType);
        const r = await api.post(`/kyc/${id}/upload-multi`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success(`${r.data.uploaded} document(s) uploaded`);
      }
      load();
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (doc) => {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return;
    try {
      await api.delete(`/kyc/document/${doc.id}`);
      toast.success('Deleted');
      load();
    } catch { toast.error('Delete failed'); }
  };

  const submitReview = async (status) => {
    try {
      await api.patch(`/kyc/document/${reviewDoc.id}`, { status, comment: reviewComment });
      toast.success(`Document ${status}`);
      setReviewDoc(null); setReviewComment(''); load();
    } catch { toast.error('Failed'); }
  };

  const fetchDocBlob = async (doc) => {
    const token = localStorage.getItem('axistra_token');
    const res = await fetch(`${API_BASE}/kyc/${id}/file/${doc.file_url.split('/').pop()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load document');
    return res.blob();
  };

  const previewDoc = async (doc) => {
    try {
      const blob = await fetchDocBlob(doc);
      setDocPreview({
        name: doc.file_name,
        type: blob.type || (doc.file_name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*'),
        url: URL.createObjectURL(blob),
      });
    } catch (err) {
      toast.error(err.message || 'Preview failed');
    }
  };

  const downloadDoc = async (doc) => {
    const blob = await fetchDocBlob(doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = doc.file_name; a.click();
  };

  return (
    <div>
      <PageHeader
        eyebrow={c.customer_code}
        title={c.full_name}
        subtitle={c.company_name || c.email || 'Customer profile'}
        actions={
          <>
            <Link to="/customers" className="btn-secondary">← Back</Link>
            {!edit ? (
              <button onClick={() => setEdit(true)} className="btn-primary" data-testid="edit-customer-btn">Edit</button>
            ) : (
              <>
                <button onClick={() => { setEdit(false); setForm(c); }} className="btn-secondary">Cancel</button>
                <button onClick={save} className="btn-primary" data-testid="save-customer-btn">Save</button>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card-axistra p-6 lg:col-span-2">
          <h3 className="font-display text-lg font-semibold mb-4">Profile</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name"><input disabled={!edit} className="input-axistra" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="First Name"><input disabled={!edit} className="input-axistra" value={form.first_name || ''} onChange={(e) => setForm({ ...form, first_name: e.target.value, full_name: [e.target.value, form.last_name].filter(Boolean).join(' ') })} /></Field>
            <Field label="Last Name"><input disabled={!edit} className="input-axistra" value={form.last_name || ''} onChange={(e) => setForm({ ...form, last_name: e.target.value, full_name: [form.first_name, e.target.value].filter(Boolean).join(' ') })} /></Field>
            <Field label="Company"><input disabled={!edit} className="input-axistra" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="Email"><input disabled={!edit} className="input-axistra" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Magnus Username *"><input disabled={!edit} required className="input-axistra" value={form.magnus_username || ''} onChange={(e) => setForm({ ...form, magnus_username: e.target.value })} /></Field>
            <Field label="Mobile Number *"><input disabled={!edit} required className="input-axistra" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Telegram"><input disabled={!edit} className="input-axistra" value={form.telegram || ''} onChange={(e) => setForm({ ...form, telegram: e.target.value })} /></Field>
            <Field label="Address" span={2}><textarea rows={2} disabled={!edit} className="input-axistra" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Country *">
              <select disabled={!edit} className="input-axistra" value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                <option value="">Select country</option>
                {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
              </select>
            </Field>
            <Field label="ID Number"><input disabled={!edit} className="input-axistra" value={form.id_number || ''} onChange={(e) => setForm({ ...form, id_number: e.target.value })} /></Field>
            <Field label="Signup IP"><input disabled className="input-axistra" value={c.signup_ip || '—'} /></Field>
            <Field label="Risk Level">
              <select disabled={!edit} className="input-axistra" value={form.risk_level || 'Low'} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}><option>Low</option><option>Medium</option><option>High</option></select>
            </Field>
            <Field label="KYC Status">
              <select disabled={!edit} className="input-axistra" value={form.kyc_status || 'not_required'} onChange={(e) => setForm({ ...form, kyc_status: e.target.value })}>
                <option value="not_required">Not Required</option><option value="requested">Requested</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </select>
            </Field>
            <Field label="Status">
              <select disabled={!edit} className="input-axistra" value={form.status || 'pending'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option>
              </select>
            </Field>
            <Field label="Created"><input disabled className="input-axistra" value={fmtDate(c.created_at)} /></Field>
            <Field label="Notes" span={2}>
              <textarea rows={3} disabled={!edit} className="input-axistra" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card-axistra p-6">
            <div className="label-xs mb-3">Status</div>
            <div className="flex flex-wrap gap-2">
              <Badge className={RISK_META[c.risk_level]?.cls}>{c.risk_level} Risk</Badge>
              <Badge className={KYC_META[c.kyc_status]?.cls}>{KYC_META[c.kyc_status]?.label}</Badge>
              <Badge className={CUSTOMER_STATUS_META[c.status]?.cls || 'badge-warning'}>{CUSTOMER_STATUS_META[c.status]?.label || c.status}</Badge>
            </div>
          </div>

          {/* KYC Upload */}
          <div className="card-axistra p-6" data-testid="kyc-upload-card">
            <div className="label-xs mb-3">KYC Documents</div>

            <div className="border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:border-[var(--axistra-green)] transition-colors">
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className="input-axistra mb-2 text-sm" data-testid="kyc-doc-type">
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={handleUpload}
                className="hidden"
                id="kyc-upload"
                data-testid="kyc-file-input"
              />
              <label htmlFor="kyc-upload" className="cursor-pointer inline-flex items-center gap-2 text-sm text-axistra-green hover:underline">
                <CloudArrowUp size={20} weight="duotone" />
                {uploading ? 'Uploading…' : 'Click to upload (PDF/PNG/JPG, max 10 MB each)'}
              </label>
              <div className="text-[10px] text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple files (e.g. ID front + back)</div>
            </div>

            <div className="mt-4 space-y-2">
              {c.kyc_documents?.length === 0 && <div className="text-sm text-gray-500">No documents uploaded.</div>}
              {c.kyc_documents?.map((k) => {
                const isPdf = k.file_name.toLowerCase().endsWith('.pdf');
                return (
                  <div key={k.id} className="border border-gray-200 rounded-md p-3" data-testid={`kyc-doc-${k.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isPdf ? <FilePdf size={18} className="text-red-600 shrink-0" weight="duotone" /> : <ImageIcon size={18} className="text-axistra-green shrink-0" weight="duotone" />}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{k.file_name}</div>
                          <div className="text-[10px] text-gray-500">{DOC_TYPES.find((d) => d.value === k.document_type)?.label || k.document_type} · {fmtDateTime(k.created_at)}</div>
                        </div>
                      </div>
                      <Badge className={STATUS_META[k.status]}>{k.status}</Badge>
                    </div>
                    {k.admin_comment && <div className="text-[11px] text-gray-600 mt-2 italic">"{k.admin_comment}"</div>}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => previewDoc(k)} className="text-[11px] text-axistra-green hover:underline inline-flex items-center gap-1" data-testid={`kyc-preview-${k.id}`}>View</button>
                      <button onClick={() => downloadDoc(k)} className="text-[11px] text-axistra-green hover:underline inline-flex items-center gap-1" data-testid={`kyc-download-${k.id}`}><DownloadSimple size={12} /> Download</button>
                      {k.status === 'submitted' && (
                        <>
                          <button onClick={() => setReviewDoc({ ...k, action: 'approved' })} className="text-[11px] text-green-700 hover:underline inline-flex items-center gap-1" data-testid={`kyc-approve-${k.id}`}><CheckCircle size={12} /> Approve</button>
                          <button onClick={() => setReviewDoc({ ...k, action: 'rejected' })} className="text-[11px] text-red-700 hover:underline inline-flex items-center gap-1" data-testid={`kyc-reject-${k.id}`}><XCircle size={12} /> Reject</button>
                        </>
                      )}
                      <button onClick={() => deleteDoc(k)} className="text-[11px] text-red-600 hover:underline inline-flex items-center gap-1 ml-auto" data-testid={`kyc-delete-${k.id}`}><Trash size={12} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Modal open={!!reviewDoc} onClose={() => setReviewDoc(null)} title={`Review document — ${reviewDoc?.action === 'approved' ? 'Approve' : 'Reject'}`} testId="kyc-review-modal">
        <div className="space-y-4">
          <div className="text-sm"><strong>{reviewDoc?.file_name}</strong></div>
          <Field label="Admin Comment">
            <textarea rows={3} className="input-axistra" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} data-testid="kyc-review-comment" placeholder="Reason / verification notes…" />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setReviewDoc(null)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => submitReview(reviewDoc.action)}
              className={reviewDoc?.action === 'approved' ? 'btn-primary' : 'btn-accent'}
              data-testid="kyc-review-submit"
            >
              Confirm {reviewDoc?.action}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!docPreview} onClose={() => setDocPreview(null)} title={docPreview?.name || 'KYC Document'} testId="kyc-preview-modal" size="xl">
        {docPreview?.type?.includes('pdf') ? (
          <iframe title={docPreview.name} src={docPreview.url} className="w-full h-[75vh] rounded border border-gray-200" />
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <img src={docPreview?.url} alt={docPreview?.name} className="max-h-[75vh] mx-auto object-contain" />
          </div>
        )}
      </Modal>
    </div>
  );
}
