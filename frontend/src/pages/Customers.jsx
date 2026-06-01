import React, { useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import { API_BASE } from '../lib/api';
import { PageHeader, Badge, Modal, Field } from '../components/Atoms';
import { RISK_META, KYC_META, CUSTOMER_STATUS_META, fmtDate, fmtDateTime } from '../lib/format';
import { COUNTRIES } from '../lib/countries';
import { Plus, MagnifyingGlass, PencilSimple, Trash, CloudArrowUp, DownloadSimple, GitMerge } from '@phosphor-icons/react';
import { toast } from 'sonner';

const empty = {
  first_name: '',
  last_name: '',
  full_name: '',
  company_name: '',
  email: '',
  phone: '',
  telegram: '',
  address: '',
  country: '',
  magnus_username: '',
  id_number: '',
  risk_level: 'Low',
  kyc_status: 'not_required',
  status: 'pending',
  notes: '',
};

const DOC_TYPES = [
  { value: 'passport', label: 'Passport / ID' },
  { value: 'company_doc', label: 'Company Document' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'source_of_funds', label: 'Source of Funds' },
  { value: 'other', label: 'Other' },
];

const toForm = (customer = {}) => ({
  ...empty,
  ...customer,
  first_name: customer.first_name || splitName(customer.full_name).first_name,
  last_name: customer.last_name || splitName(customer.full_name).last_name,
});

const splitName = (name = '') => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '' };
};

const buildPayload = (form) => ({
  ...form,
  full_name: [form.first_name, form.last_name].filter(Boolean).join(' ') || form.full_name || form.company_name || form.magnus_username,
});

export default function Customers() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [docType, setDocType] = useState('passport');
  const [file, setFile] = useState(null);
  const [docPreview, setDocPreview] = useState(null);
  const fileRef = useRef(null);

  const load = () => {
    const params = {};
    if (search) params.search = search;
    if (risk) params.risk_level = risk;
    if (status) params.status = status;
    api.get('/customers', { params }).then((r) => setItems(r.data));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [risk, status]);

  const mergeDuplicates = async () => {
    if (!window.confirm('Find customers whose Magnus username differs only by case (e.g. "maradona10" vs "Maradona10") and merge them?\n\nAll recharges, invoices, KYC docs and ledger entries will be repointed to the oldest customer. Duplicates are then deleted.')) return;
    try {
      const { data } = await api.post('/customers/merge-duplicates');
      if (data.merged_groups === 0) {
        toast.success('No case-duplicate customers found');
      } else {
        const lines = data.summary
          .map((s) => `${s.magnus_username}: kept ${s.canonical_id.slice(0, 8)}, merged ${s.merged_ids.length} duplicate(s)`)
          .join('\n');
        toast.success(`Merged ${data.merged_groups} group(s):\n${lines}`, { duration: 8000 });
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Merge failed');
    }
  };

  const resetFile = () => {
    setFile(null);
    setDocType('passport');
    if (fileRef.current) fileRef.current.value = '';
  };

  const openCreate = () => {
    setMode('create');
    setSelected(null);
    setForm(empty);
    resetFile();
    setModalOpen(true);
  };

  const openCustomer = async (id) => {
    try {
      const { data } = await api.get(`/customers/${id}`);
      setSelected(data);
      setForm(toForm(data));
      setMode('view');
      resetFile();
      setModalOpen(true);
    } catch {
      toast.error('Could not load customer');
    }
  };

  const refreshSelected = async (id = selected?.id) => {
    if (!id) return;
    const { data } = await api.get(`/customers/${id}`);
    setSelected(data);
    setForm(toForm(data));
  };

  const uploadDoc = async (customerId) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('Max KYC upload size is 10 MB');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', docType);
    await api.post(`/kyc/${customerId}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    resetFile();
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'create') {
        const { data } = await api.post('/customers', buildPayload(form));
        await uploadDoc(data.id);
        toast.success(file ? 'Customer created with KYC document' : 'Customer created');
        setModalOpen(false);
        setForm(empty);
        load();
      } else {
        await api.patch(`/customers/${selected.id}`, buildPayload(form));
        await uploadDoc(selected.id);
        toast.success(file ? 'Customer updated with KYC document' : 'Customer updated');
        await refreshSelected(selected.id);
        setMode('view');
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const removeCustomer = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected.customer_code} permanently?`)) return;
    try {
      await api.delete(`/customers/${selected.id}`);
      toast.success('Customer deleted');
      setModalOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  const fetchDocBlob = async (doc) => {
    const token = localStorage.getItem('axistra_token');
    const res = await fetch(`${API_BASE}/kyc/${selected.id}/file/${doc.file_url.split('/').pop()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load document');
    const blob = await res.blob();
    return blob;
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
    a.href = URL.createObjectURL(blob);
    a.download = doc.file_name;
    a.click();
  };

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Customers"
        subtitle="Manage normal and high-risk customers with KYC posture, Magnus profile data, and audit history."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={mergeDuplicates}
              className="btn-secondary inline-flex items-center gap-2"
              title="Merge customers whose Magnus username differs only by case"
              data-testid="merge-duplicates-btn"
            >
              <GitMerge size={16} /> Merge case-duplicates
            </button>
            <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" data-testid="add-customer-btn">
              <Plus size={16} /> Add Customer
            </button>
          </div>
        }
      />

      <div className="card-axistra p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search by name, email, phone, Telegram, Magnus username, code, ID number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="input-axistra pl-9"
            data-testid="customer-search-input"
          />
        </div>
        <select value={risk} onChange={(e) => setRisk(e.target.value)} className="input-axistra md:w-44" data-testid="customer-risk-filter">
          <option value="">All risk</option><option>Low</option><option>Medium</option><option>High</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-axistra md:w-44" data-testid="customer-status-filter">
          <option value="">All status</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option>
        </select>
        <button onClick={load} className="btn-secondary" data-testid="customer-apply-filter">Apply</button>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Magnus User</th><th>Contact</th>
              <th>Country</th><th>Risk</th><th>KYC</th><th>Status</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="9" className="text-center text-gray-500 py-10">No customers yet. Click <strong>Add Customer</strong> to begin.</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => openCustomer(c.id)} className="cursor-pointer hover:bg-[var(--axistra-bg)]" data-testid={`customer-row-${c.customer_code}`}>
                <td className="font-mono text-axistra-green font-medium">{c.customer_code}</td>
                <td>
                  <div className="font-medium text-gray-900">{c.full_name}</div>
                  {c.company_name && <div className="text-xs text-gray-500">{c.company_name}</div>}
                </td>
                <td className="font-mono text-xs">{c.magnus_username || '-'}</td>
                <td className="text-xs text-gray-600">
                  <div>{c.email || '-'}</div>
                  <div>{c.phone || c.telegram || ''}</div>
                </td>
                <td>{c.country || '-'}</td>
                <td><Badge className={RISK_META[c.risk_level]?.cls}>{c.risk_level}</Badge></td>
                <td><Badge className={KYC_META[c.kyc_status]?.cls}>{KYC_META[c.kyc_status]?.label || c.kyc_status}</Badge></td>
                <td><Badge className={CUSTOMER_STATUS_META[c.status]?.cls || 'badge-warning'}>{CUSTOMER_STATUS_META[c.status]?.label || c.status}</Badge></td>
                <td className="text-xs text-gray-500">{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={mode === 'create' ? 'Add Customer' : `${selected?.customer_code || ''} Customer Details`}
        testId="customer-modal"
        size="lg"
      >
        {mode !== 'create' && selected && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge className={RISK_META[selected.risk_level]?.cls}>{selected.risk_level} Risk</Badge>
              <Badge className={KYC_META[selected.kyc_status]?.cls}>{KYC_META[selected.kyc_status]?.label || selected.kyc_status}</Badge>
              <Badge className={CUSTOMER_STATUS_META[selected.status]?.cls || 'badge-warning'}>{CUSTOMER_STATUS_META[selected.status]?.label || selected.status}</Badge>
            </div>
            <div className="flex gap-2">
              {mode === 'view' ? (
                <button onClick={() => setMode('edit')} className="btn-primary inline-flex items-center gap-2" data-testid="customer-edit-btn"><PencilSimple size={15} /> Edit</button>
              ) : (
                <button onClick={() => { setMode('view'); setForm(toForm(selected)); resetFile(); }} className="btn-secondary">Cancel Edit</button>
              )}
              <button onClick={removeCustomer} className="btn-secondary inline-flex items-center gap-2 text-red-700" data-testid="customer-delete-btn"><Trash size={15} /> Delete</button>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First Name *">
            <input required disabled={mode === 'view'} value={form.first_name || ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="input-axistra" data-testid="cust-form-first-name" />
          </Field>
          <Field label="Last Name *">
            <input required disabled={mode === 'view'} value={form.last_name || ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="input-axistra" data-testid="cust-form-last-name" />
          </Field>
          <Field label="Email *">
            <input required type="email" disabled={mode === 'view'} value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-axistra" data-testid="cust-form-email" />
          </Field>
          <Field label="Mobile Number *">
            <input required disabled={mode === 'view'} value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-axistra" data-testid="cust-form-phone" />
          </Field>
          <Field label="Address" span={2}>
            <textarea rows={2} disabled={mode === 'view'} value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-axistra" data-testid="cust-form-address" />
          </Field>
          <Field label="Country *">
            <select required disabled={mode === 'view'} value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input-axistra" data-testid="cust-form-country">
              <option value="">Select country</option>
              {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
            </select>
          </Field>
          <Field label="Magnus Username *">
            <input required disabled={mode === 'view'} value={form.magnus_username || ''} onChange={(e) => setForm({ ...form, magnus_username: e.target.value })} className="input-axistra" data-testid="cust-form-magnus" />
          </Field>
          <Field label="Company Name">
            <input disabled={mode === 'view'} value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="input-axistra" data-testid="cust-form-company" />
          </Field>
          <Field label="Telegram Username">
            <input disabled={mode === 'view'} value={form.telegram || ''} onChange={(e) => setForm({ ...form, telegram: e.target.value })} className="input-axistra" data-testid="cust-form-telegram" />
          </Field>
          <Field label="ID Number">
            <input disabled={mode === 'view'} value={form.id_number || ''} onChange={(e) => setForm({ ...form, id_number: e.target.value })} className="input-axistra" data-testid="cust-form-id-number" />
          </Field>
          <Field label="Risk Level">
            <select disabled={mode === 'view'} value={form.risk_level || 'Low'} onChange={(e) => setForm({ ...form, risk_level: e.target.value })} className="input-axistra" data-testid="cust-form-risk">
              <option>Low</option><option>Medium</option><option>High</option>
            </select>
          </Field>
          <Field label="KYC Status">
            <select disabled={mode === 'view'} value={form.kyc_status || 'not_required'} onChange={(e) => setForm({ ...form, kyc_status: e.target.value })} className="input-axistra" data-testid="cust-form-kyc">
              <option value="not_required">Not Required</option>
              <option value="requested">Requested</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <Field label="Account Status">
            <select disabled={mode === 'view'} value={form.status || 'pending'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-axistra" data-testid="cust-form-status">
              <option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option>
            </select>
          </Field>
          <Field label="KYC Document Upload" span={2}>
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
              <select disabled={mode === 'view'} value={docType} onChange={(e) => setDocType(e.target.value)} className="input-axistra" data-testid="cust-form-doc-type">
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className={`input-axistra flex items-center gap-2 ${mode === 'view' ? 'opacity-60' : 'cursor-pointer'}`}>
                <CloudArrowUp size={18} weight="duotone" className="text-axistra-green" />
                <span className="truncate text-sm">{file ? file.name : 'Choose PDF/PNG/JPG document'}</span>
                <input ref={fileRef} disabled={mode === 'view'} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" data-testid="cust-form-kyc-file" />
              </label>
            </div>
          </Field>
          <Field label="Notes" span={2}>
            <textarea rows={3} disabled={mode === 'view'} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-axistra" data-testid="cust-form-notes" />
          </Field>

          {selected?.kyc_documents?.length > 0 && (
            <div className="md:col-span-2 border border-gray-200 rounded-lg p-4">
              <div className="label-xs mb-3">Uploaded KYC Documents</div>
              <div className="space-y-2">
                {selected.kyc_documents.map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border border-gray-100 rounded-md px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{doc.file_name}</div>
                      <div className="text-xs text-gray-500">{DOC_TYPES.find((d) => d.value === doc.document_type)?.label || doc.document_type} · {fmtDateTime(doc.created_at)} · {doc.status}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => previewDoc(doc)} className="text-axistra-green text-xs inline-flex items-center gap-1 hover:underline">View</button>
                      <button type="button" onClick={() => downloadDoc(doc)} className="text-axistra-green text-xs inline-flex items-center gap-1 hover:underline"><DownloadSimple size={13} /> Download</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="md:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Close</button>
            {mode !== 'view' && <button type="submit" disabled={loading} className="btn-primary" data-testid="cust-form-submit">{loading ? 'Saving...' : mode === 'create' ? 'Create Customer' : 'Save Customer'}</button>}
          </div>
        </form>
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
