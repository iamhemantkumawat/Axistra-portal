import React, { useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge, Field, Modal } from '../components/Atoms';
import { toast } from 'sonner';
import { FileText, Pencil, Trash, FilePdf, DownloadSimple, Handshake } from '@phosphor-icons/react';

const TYPES = [
  { value: 'customer_agreement', label: 'Customer Agreement' },
  { value: 'nda', label: 'NDA' },
  { value: 'supplier', label: 'Supplier Agreement' },
  { value: 'employment', label: 'Employment Contract' },
  { value: 'service', label: 'Service Agreement' },
  { value: 'other', label: 'Other' },
];

const STATUS_META = {
  draft: 'badge-neutral',
  active: 'badge-success',
  expired: 'badge-error',
  terminated: 'badge-error',
  renewed: 'badge-info',
};

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtMoney = (n, c = 'AED') => `${c} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Contracts() {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [customers, setCustomers] = useState([]);
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    title: '', contract_type: 'customer_agreement', counterparty_name: '', customer_id: '',
    reference_number: '', signed_at: '', start_date: '', end_date: '',
    status: 'active', contract_value: '0', currency: 'AED', notes: '',
  });

  const load = async () => {
    const [c, custs] = await Promise.all([api.get('/contracts'), api.get('/customers').catch(() => ({ data: [] }))]);
    setItems(c.data); setCustomers(custs.data || []);
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({
      title: '', contract_type: 'customer_agreement', counterparty_name: '', customer_id: '',
      reference_number: '', signed_at: '', start_date: '', end_date: '',
      status: 'active', contract_value: '0', currency: 'AED', notes: '',
    });
    setEditing(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v !== '' && v != null && fd.append(k, v));
      const file = fileRef.current?.files?.[0];
      if (file) fd.append('file', file);
      const url = editing ? `/contracts/${editing.id}` : '/contracts';
      const method = editing ? 'patch' : 'post';
      await api[method](url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(editing ? 'Contract updated' : 'Contract created');
      setShowForm(false); resetForm(); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };

  const onEdit = (c) => {
    setEditing(c);
    setForm({
      title: c.title || '', contract_type: c.contract_type || 'customer_agreement',
      counterparty_name: c.counterparty_name || '', customer_id: c.customer_id || '',
      reference_number: c.reference_number || '',
      signed_at: c.signed_at ? c.signed_at.slice(0, 10) : '',
      start_date: c.start_date ? c.start_date.slice(0, 10) : '',
      end_date: c.end_date ? c.end_date.slice(0, 10) : '',
      status: c.status || 'active',
      contract_value: c.contract_value || '0',
      currency: c.currency || 'AED', notes: c.notes || '',
    });
    setShowForm(true);
  };

  const onDelete = async (c) => {
    if (!window.confirm(`Delete "${c.title}"?`)) return;
    try { await api.delete(`/contracts/${c.id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  };

  const onDownload = async (c) => {
    try {
      const token = localStorage.getItem('axistra_token');
      const fname = c.file_url.split('/').slice(-2)[0];
      const res = await fetch(`${API_BASE}/contracts/${fname}/file`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = c.file_name; a.click();
    } catch { toast.error('Download failed'); }
  };

  const filtered = filter === 'all' ? items : items.filter((c) => c.contract_type === filter);
  const stats = {
    total: items.length,
    active: items.filter((c) => c.status === 'active').length,
    expiring: items.filter((c) => c.end_date && c.status === 'active' && new Date(c.end_date) - new Date() <= 60 * 86400000).length,
    expired: items.filter((c) => c.status === 'expired').length,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Vault"
        title="Contracts Vault"
        subtitle="Customer agreements, NDAs, supplier and employment contracts — searchable and expiry-tracked."
        actions={<button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary" data-testid="contract-add-btn">+ New Contract</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="card-axistra p-4"><div className="label-xs">Total</div><div className="font-display text-2xl font-bold mt-1">{stats.total}</div></div>
        <div className="card-axistra p-4"><div className="label-xs">Active</div><div className="font-display text-2xl font-bold mt-1 text-green-700">{stats.active}</div></div>
        <div className="card-axistra p-4"><div className="label-xs">Expiring &lt;60d</div><div className="font-display text-2xl font-bold mt-1 text-amber-600">{stats.expiring}</div></div>
        <div className="card-axistra p-4"><div className="label-xs">Expired</div><div className="font-display text-2xl font-bold mt-1 text-red-600">{stats.expired}</div></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-[var(--axistra-green)] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>All ({items.length})</button>
        {TYPES.map((t) => {
          const count = items.filter((i) => i.contract_type === t.value).length;
          if (!count) return null;
          return (
            <button key={t.value} onClick={() => setFilter(t.value)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === t.value ? 'bg-[var(--axistra-green)] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Counterparty</th>
              <th>Signed</th>
              <th>Validity</th>
              <th className="text-right">Value</th>
              <th>Status</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan="9" className="text-center py-10 text-gray-500">No contracts yet.</td></tr>}
            {filtered.map((c) => (
              <tr key={c.id} data-testid={`contract-row-${c.id}`}>
                <td className="font-medium text-sm">{c.title}</td>
                <td className="text-xs">{TYPES.find((t) => t.value === c.contract_type)?.label}</td>
                <td className="text-xs">{c.counterparty_name || (c.customer_id ? customers.find((cu) => cu.id === c.customer_id)?.full_name : '—')}</td>
                <td className="text-xs">{fmt(c.signed_at)}</td>
                <td className="text-xs">{fmt(c.start_date)} → {fmt(c.end_date)}</td>
                <td className="text-right text-xs">{fmtMoney(c.contract_value, c.currency)}</td>
                <td><Badge className={STATUS_META[c.status] || 'badge-neutral'}>{c.status}</Badge></td>
                <td>
                  {c.file_url ? (
                    <button onClick={() => onDownload(c)} className="text-xs text-axistra-green hover:underline inline-flex items-center gap-1" data-testid={`contract-download-${c.id}`}>
                      <FilePdf size={14} /> {c.file_name?.slice(0, 18)}…
                    </button>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="text-right">
                  <button onClick={() => onEdit(c)} className="text-gray-500 hover:text-axistra-green mr-2" data-testid={`contract-edit-${c.id}`}><Pencil size={14} /></button>
                  <button onClick={() => onDelete(c)} className="text-red-500 hover:text-red-700" data-testid={`contract-delete-${c.id}`}><Trash size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title={editing ? 'Edit Contract' : 'New Contract'} size="lg" testId="contract-modal">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title *">
            <input required className="input-axistra" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Master Services Agreement – Acme Corp" data-testid="contract-title" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contract Type *">
              <select required className="input-axistra" value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Status *">
              <select required className="input-axistra" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
                <option value="renewed">Renewed</option>
              </select>
            </Field>
            <Field label="Counterparty Name">
              <input className="input-axistra" value={form.counterparty_name} onChange={(e) => setForm({ ...form, counterparty_name: e.target.value })} placeholder="Free-text (use for non-customer parties)" />
            </Field>
            <Field label="Linked Customer (optional)">
              <select className="input-axistra" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">— None —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.customer_code})</option>)}
              </select>
            </Field>
            <Field label="Reference Number"><input className="input-axistra" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} /></Field>
            <Field label="Signed Date"><input type="date" className="input-axistra" value={form.signed_at} onChange={(e) => setForm({ ...form, signed_at: e.target.value })} /></Field>
            <Field label="Start Date"><input type="date" className="input-axistra" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="End Date"><input type="date" className="input-axistra" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
            <Field label="Contract Value"><input type="number" step="0.01" className="input-axistra" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: e.target.value })} /></Field>
            <Field label="Currency">
              <select className="input-axistra" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>AED</option><option>USD</option><option>EUR</option><option>GBP</option>
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea rows={2} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Field label="Signed Contract File (PDF / DOCX)">
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" className="block w-full text-sm" data-testid="contract-file" />
            {editing?.file_name && <div className="text-[11px] text-gray-500 mt-1">Current: {editing.file_name}. Choose a new file to replace.</div>}
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="contract-save">{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
