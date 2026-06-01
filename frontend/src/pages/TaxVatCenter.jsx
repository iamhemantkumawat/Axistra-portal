import React, { useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge, Field, Modal, KpiCard } from '../components/Atoms';
import { toast } from 'sonner';
import { Receipt, Calendar, CheckCircle, Warning, FileText, Pencil, Trash, DownloadSimple, FilePdf, CurrencyDollar } from '@phosphor-icons/react';

const TAX_TYPES = [
  { value: 'vat', label: 'VAT' },
  { value: 'corporate_tax', label: 'Corporate Tax' },
  { value: 'excise', label: 'Excise' },
  { value: 'wht', label: 'Withholding Tax' },
  { value: 'other', label: 'Other' },
];

const STATUS_META = {
  upcoming: 'badge-info',
  in_progress: 'badge-warning',
  filed: 'badge-success',
  paid: 'badge-success',
  overdue: 'badge-error',
  exempt: 'badge-neutral',
};

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtAed = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysUntil = (d) => (d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null);

export default function TaxVatCenter() {
  const [filings, setFilings] = useState([]);
  const [summary, setSummary] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    tax_type: 'vat', period_label: '', period_start: '', period_end: '', due_date: '',
    filed_at: '', paid_at: '', status: 'upcoming',
    taxable_amount_aed: '0', tax_due_aed: '0', tax_paid_aed: '0',
    reference_number: '', trn: '105415374500001', notes: '',
  });

  const load = async () => {
    const [f, s] = await Promise.all([api.get('/tax'), api.get('/tax/summary')]);
    setFilings(f.data); setSummary(s.data);
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({
      tax_type: 'vat', period_label: '', period_start: '', period_end: '', due_date: '',
      filed_at: '', paid_at: '', status: 'upcoming',
      taxable_amount_aed: '0', tax_due_aed: '0', tax_paid_aed: '0',
      reference_number: '', trn: '105415374500001', notes: '',
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
      const url = editing ? `/tax/${editing.id}` : '/tax';
      const method = editing ? 'patch' : 'post';
      await api[method](url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(editing ? 'Filing updated' : 'Filing created');
      setShowForm(false); resetForm(); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
  };

  const onEdit = (f) => {
    setEditing(f);
    setForm({
      tax_type: f.tax_type || 'vat', period_label: f.period_label || '',
      period_start: f.period_start ? f.period_start.slice(0, 10) : '',
      period_end: f.period_end ? f.period_end.slice(0, 10) : '',
      due_date: f.due_date ? f.due_date.slice(0, 10) : '',
      filed_at: f.filed_at ? f.filed_at.slice(0, 10) : '',
      paid_at: f.paid_at ? f.paid_at.slice(0, 10) : '',
      status: f.status || 'upcoming',
      taxable_amount_aed: f.taxable_amount_aed || '0',
      tax_due_aed: f.tax_due_aed || '0',
      tax_paid_aed: f.tax_paid_aed || '0',
      reference_number: f.reference_number || '',
      trn: f.trn || '', notes: f.notes || '',
    });
    setShowForm(true);
  };

  const onDelete = async (f) => {
    if (!window.confirm(`Delete "${f.period_label}"?`)) return;
    try { await api.delete(`/tax/${f.id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Delete failed'); }
  };

  const onDownload = async (f) => {
    try {
      const token = localStorage.getItem('axistra_token');
      const fname = f.file_url.split('/').slice(-2)[0];
      const res = await fetch(`${API_BASE}/tax/${fname}/file`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.file_name; a.click();
    } catch { toast.error('Download failed'); }
  };

  const filtered = filter === 'all' ? filings : filings.filter((f) => f.tax_type === filter);

  return (
    <div>
      <PageHeader
        eyebrow="Compliance"
        title="Tax & VAT Center"
        subtitle="Track UAE Corporate Tax, VAT returns, and other tax filings. Upload filed returns and stay ahead of due dates."
        actions={<button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary" data-testid="tax-add-btn">+ New Filing</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <KpiCard label="Total Filings" value={summary.total_filings || 0} icon={Receipt} testId="tax-kpi-total" />
        <KpiCard label="Upcoming" value={summary.upcoming?.length || 0} icon={Calendar} testId="tax-kpi-upcoming" />
        <KpiCard label="Overdue" value={summary.overdue_count || 0} icon={Warning} testId="tax-kpi-overdue" accent={summary.overdue_count > 0} />
        <KpiCard label="Total Paid" value={fmtAed(summary.total_paid_aed)} icon={CheckCircle} testId="tax-kpi-paid" />
        <KpiCard label="Outstanding" value={fmtAed(summary.outstanding_aed)} icon={CurrencyDollar} testId="tax-kpi-outstanding" />
      </div>

      {summary.upcoming?.length > 0 && (
        <div className="card-axistra p-5 mb-5">
          <h3 className="font-display text-base font-semibold mb-3">Upcoming Filings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.upcoming.map((u) => {
              const days = daysUntil(u.due_date);
              const urgent = days <= 14;
              return (
                <div key={u.id} className={`border rounded-lg p-3 ${urgent ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{TAX_TYPES.find((t) => t.value === u.tax_type)?.label} · {u.period_label}</div>
                    <Badge className={urgent ? 'badge-warning' : 'badge-info'}>{days} days</Badge>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">Due {fmt(u.due_date)}</div>
                  <div className="text-xs text-gray-700 mt-1">{fmtAed(u.tax_due_aed)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-[var(--axistra-green)] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>All ({filings.length})</button>
        {TAX_TYPES.map((t) => {
          const count = filings.filter((f) => f.tax_type === t.value).length;
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
              <th>Type</th>
              <th>Period</th>
              <th>Due Date</th>
              <th>Status</th>
              <th className="text-right">Taxable</th>
              <th className="text-right">Tax Due</th>
              <th className="text-right">Paid</th>
              <th>Reference</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan="10" className="text-center py-10 text-gray-500">No filings yet.</td></tr>}
            {filtered.map((f) => (
              <tr key={f.id} data-testid={`tax-row-${f.id}`}>
                <td className="font-medium text-xs">{TAX_TYPES.find((t) => t.value === f.tax_type)?.label || f.tax_type}</td>
                <td className="text-xs">{f.period_label}</td>
                <td className="text-xs">{fmt(f.due_date)}</td>
                <td><Badge className={STATUS_META[f.status] || 'badge-neutral'}>{f.status}</Badge></td>
                <td className="text-right text-xs">{fmtAed(f.taxable_amount_aed)}</td>
                <td className="text-right text-xs font-semibold">{fmtAed(f.tax_due_aed)}</td>
                <td className="text-right text-xs">{fmtAed(f.tax_paid_aed)}</td>
                <td className="font-mono text-[11px]">{f.reference_number || '—'}</td>
                <td>
                  {f.file_url ? (
                    <button onClick={() => onDownload(f)} className="text-xs text-axistra-green hover:underline inline-flex items-center gap-1" data-testid={`tax-download-${f.id}`}>
                      <FilePdf size={14} /> {f.file_name?.slice(0, 16)}…
                    </button>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="text-right">
                  <button onClick={() => onEdit(f)} className="text-gray-500 hover:text-axistra-green mr-2" data-testid={`tax-edit-${f.id}`}><Pencil size={14} /></button>
                  <button onClick={() => onDelete(f)} className="text-red-500 hover:text-red-700" data-testid={`tax-delete-${f.id}`}><Trash size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title={editing ? 'Edit Tax Filing' : 'New Tax Filing'} size="lg" testId="tax-modal">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tax Type *">
              <select required className="input-axistra" value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })} data-testid="tax-type">
                {TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Period Label *">
              <input required className="input-axistra" value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} placeholder="Q1 2026 / FY 2025" data-testid="tax-period" />
            </Field>
            <Field label="Period Start"><input type="date" className="input-axistra" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} /></Field>
            <Field label="Period End"><input type="date" className="input-axistra" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} /></Field>
            <Field label="Due Date *"><input type="date" required className="input-axistra" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} data-testid="tax-due" /></Field>
            <Field label="Status *">
              <select required className="input-axistra" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="upcoming">Upcoming</option>
                <option value="in_progress">In Progress</option>
                <option value="filed">Filed</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="exempt">Exempt</option>
              </select>
            </Field>
            <Field label="Filed Date"><input type="date" className="input-axistra" value={form.filed_at} onChange={(e) => setForm({ ...form, filed_at: e.target.value })} /></Field>
            <Field label="Paid Date"><input type="date" className="input-axistra" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></Field>
            <Field label="Taxable Amount (AED)"><input type="number" step="0.01" className="input-axistra" value={form.taxable_amount_aed} onChange={(e) => setForm({ ...form, taxable_amount_aed: e.target.value })} /></Field>
            <Field label="Tax Due (AED)"><input type="number" step="0.01" className="input-axistra" value={form.tax_due_aed} onChange={(e) => setForm({ ...form, tax_due_aed: e.target.value })} /></Field>
            <Field label="Tax Paid (AED)"><input type="number" step="0.01" className="input-axistra" value={form.tax_paid_aed} onChange={(e) => setForm({ ...form, tax_paid_aed: e.target.value })} /></Field>
            <Field label="TRN"><input className="input-axistra" value={form.trn} onChange={(e) => setForm({ ...form, trn: e.target.value })} /></Field>
            <Field label="Reference Number" span={2}><input className="input-axistra" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} placeholder="Acknowledgement / Receipt no" /></Field>
            <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Attachment (PDF/XLSX) – optional" span={2}>
              <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg" className="block w-full text-sm" data-testid="tax-file" />
              {editing?.file_name && <div className="text-[11px] text-gray-500 mt-1">Current: {editing.file_name}. Choose a new file to replace.</div>}
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="tax-save">{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
