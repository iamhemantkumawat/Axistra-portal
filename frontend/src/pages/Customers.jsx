import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge, Modal, Field } from '../components/Atoms';
import { RISK_META, KYC_META, fmtDate } from '../lib/format';
import { Plus, MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const empty = {
  full_name: '', company_name: '', email: '', phone: '', telegram: '',
  country: '', magnus_username: '', risk_level: 'Low', kyc_status: 'not_required',
  status: 'active', notes: '',
};

export default function Customers() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState('');
  const [status, setStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

  const load = () => {
    const params = {};
    if (search) params.search = search;
    if (risk) params.risk_level = risk;
    if (status) params.status = status;
    api.get('/customers', { params }).then((r) => setItems(r.data));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [risk, status]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/customers', form);
      toast.success('Customer created');
      setModalOpen(false);
      setForm(empty);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Customers"
        subtitle="Manage normal and high-risk customers with KYC posture and audit history."
        actions={
          <button onClick={() => setModalOpen(true)} className="btn-primary inline-flex items-center gap-2" data-testid="add-customer-btn">
            <Plus size={16} /> Add Customer
          </button>
        }
      />

      <div className="card-axistra p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search by name, email, Magnus username, code…"
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
          <option value="">All status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option>
        </select>
        <button onClick={load} className="btn-secondary" data-testid="customer-apply-filter">Apply</button>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Magnus User</th><th>Country</th>
              <th>Risk</th><th>KYC</th><th>Status</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="8" className="text-center text-gray-500 py-10">No customers yet. Click <strong>Add Customer</strong> to begin.</td></tr>}
            {items.map((c) => (
              <tr key={c.id} data-testid={`customer-row-${c.customer_code}`}>
                <td className="font-mono text-axistra-green font-medium">{c.customer_code}</td>
                <td>
                  <Link to={`/customers/${c.id}`} className="font-medium text-gray-900 hover:text-axistra-green">{c.full_name}</Link>
                  {c.email && <div className="text-xs text-gray-500">{c.email}</div>}
                </td>
                <td className="font-mono text-xs">{c.magnus_username || '—'}</td>
                <td>{c.country || '—'}</td>
                <td><Badge className={RISK_META[c.risk_level]?.cls}>{c.risk_level}</Badge></td>
                <td><Badge className={KYC_META[c.kyc_status]?.cls}>{KYC_META[c.kyc_status]?.label || c.kyc_status}</Badge></td>
                <td>
                  <Badge className={c.status === 'active' ? 'badge-success' : c.status === 'blocked' ? 'badge-error' : 'badge-warning'}>{c.status}</Badge>
                </td>
                <td className="text-xs text-gray-500">{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Customer" testId="add-customer-modal">
        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full Name *">
            <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-axistra" data-testid="cust-form-name" />
          </Field>
          <Field label="Company Name">
            <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="input-axistra" data-testid="cust-form-company" />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-axistra" data-testid="cust-form-email" />
          </Field>
          <Field label="Magnus Username">
            <input value={form.magnus_username} onChange={(e) => setForm({ ...form, magnus_username: e.target.value })} className="input-axistra" data-testid="cust-form-magnus" />
          </Field>
          <Field label="Phone / Telegram">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-axistra" data-testid="cust-form-phone" />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input-axistra" data-testid="cust-form-country" />
          </Field>
          <Field label="Risk Level">
            <select value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })} className="input-axistra" data-testid="cust-form-risk">
              <option>Low</option><option>Medium</option><option>High</option>
            </select>
          </Field>
          <Field label="KYC Status">
            <select value={form.kyc_status} onChange={(e) => setForm({ ...form, kyc_status: e.target.value })} className="input-axistra" data-testid="cust-form-kyc">
              <option value="not_required">Not Required</option>
              <option value="requested">Requested</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
          <Field label="Notes" span={2}>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-axistra" data-testid="cust-form-notes" />
          </Field>
          <div className="md:col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="cust-form-submit">{loading ? 'Saving…' : 'Create Customer'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
