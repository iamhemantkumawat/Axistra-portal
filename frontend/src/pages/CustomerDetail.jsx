import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { PageHeader, Badge, Field, Hash } from '../components/Atoms';
import { RISK_META, KYC_META, fmtDate, fmtMoney } from '../lib/format';
import { toast } from 'sonner';

export default function CustomerDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});

  const load = () => api.get(`/customers/${id}`).then((r) => { setC(r.data); setForm(r.data); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!c) return <div className="text-gray-500">Loading…</div>;

  const save = async () => {
    try {
      await api.patch(`/customers/${id}`, form);
      toast.success('Customer updated');
      setEdit(false); load();
    } catch (e) { toast.error('Update failed'); }
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
            <Field label="Company"><input disabled={!edit} className="input-axistra" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="Email"><input disabled={!edit} className="input-axistra" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Magnus Username"><input disabled={!edit} className="input-axistra" value={form.magnus_username || ''} onChange={(e) => setForm({ ...form, magnus_username: e.target.value })} /></Field>
            <Field label="Phone"><input disabled={!edit} className="input-axistra" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Telegram"><input disabled={!edit} className="input-axistra" value={form.telegram || ''} onChange={(e) => setForm({ ...form, telegram: e.target.value })} /></Field>
            <Field label="Country"><input disabled={!edit} className="input-axistra" value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
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
              <select disabled={!edit} className="input-axistra" value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option>
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
              <Badge className={c.status === 'active' ? 'badge-success' : c.status === 'blocked' ? 'badge-error' : 'badge-warning'}>{c.status}</Badge>
            </div>
          </div>

          <div className="card-axistra p-6">
            <div className="label-xs mb-3">KYC Documents</div>
            {c.kyc_documents?.length === 0 && <div className="text-sm text-gray-500">No documents uploaded.</div>}
            {c.kyc_documents?.map((k) => (
              <div key={k.id} className="text-sm border-b last:border-0 py-2">
                <div className="font-medium">{k.document_type}</div>
                <div className="text-xs text-gray-500">{k.file_name} · {fmtDate(k.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
