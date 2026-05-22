import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Modal, Field, Badge } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';
import { toast } from 'sonner';
import { Shield, Warning, UserMinus, Money } from '@phosphor-icons/react';

const ACTION_META = {
  mark_high_risk: { label: 'High Risk', cls: 'badge-error' },
  request_kyc: { label: 'KYC Requested', cls: 'badge-warning' },
  block: { label: 'Blocked', cls: 'badge-error' },
  refund: { label: 'Refund', cls: 'badge-neutral' },
  suspicious_note: { label: 'Suspicious Note', cls: 'badge-warning' },
};

export default function Compliance() {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(null); // 'kyc' | 'block' | 'risk' | 'refund' | 'log'
  const [form, setForm] = useState({ customer_id: '', notes: '', amount: '', currency: 'USD' });

  const load = () => api.get('/compliance').then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get('/customers').then((r) => setCustomers(r.data));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const map = {
      kyc: '/compliance/request-kyc',
      block: '/compliance/block-user',
      risk: '/compliance/mark-high-risk',
      refund: '/compliance/refund',
      log: '/compliance/log',
    };
    const url = map[open];
    const body = open === 'log' ? { ...form, action: 'suspicious_note' } : form;
    try {
      await api.post(url, body);
      toast.success('Compliance action recorded');
      setOpen(null); setForm({ customer_id: '', notes: '', amount: '', currency: 'USD' }); load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Risk & AML"
        title="Compliance Logs"
        subtitle="Document KYC requests, blocked users, refunds, and suspicious activity for regulator-ready audits."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setOpen('risk')} className="btn-secondary inline-flex items-center gap-1" data-testid="comp-risk-btn"><Warning size={14} /> Mark High Risk</button>
            <button onClick={() => setOpen('kyc')} className="btn-secondary inline-flex items-center gap-1" data-testid="comp-kyc-btn"><Shield size={14} /> Request KYC</button>
            <button onClick={() => setOpen('block')} className="btn-secondary inline-flex items-center gap-1 text-red-700" data-testid="comp-block-btn"><UserMinus size={14} /> Block</button>
            <button onClick={() => setOpen('refund')} className="btn-secondary inline-flex items-center gap-1" data-testid="comp-refund-btn"><Money size={14} /> Refund</button>
            <button onClick={() => setOpen('log')} className="btn-primary" data-testid="comp-log-btn">+ Add Note</button>
          </div>
        }
      />

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Date</th><th>Customer</th><th>Action</th><th>Risk</th><th>Notes</th><th>By</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="6" className="text-center text-gray-500 py-10">No compliance logs yet.</td></tr>}
            {items.map((c) => {
              const cust = customers.find((x) => x.id === c.customer_id);
              const meta = ACTION_META[c.action] || { label: c.action, cls: 'badge-neutral' };
              return (
                <tr key={c.id} data-testid={`comp-row-${c.id}`}>
                  <td className="text-xs">{fmtDateTime(c.created_at)}</td>
                  <td className="font-medium">{cust?.full_name || c.customer_id?.slice(0, 8) || '—'}<div className="text-xs text-gray-500">{cust?.customer_code}</div></td>
                  <td><Badge className={meta.cls}>{meta.label}</Badge></td>
                  <td><Badge className={c.risk_level === 'High' ? 'badge-error' : c.risk_level === 'Medium' ? 'badge-warning' : 'badge-success'}>{c.risk_level}</Badge></td>
                  <td className="text-sm">{c.notes || '—'}{c.refund_amount && <div className="text-xs text-gray-500 mt-1">Refund: {c.refund_amount} {c.refund_currency}</div>}</td>
                  <td className="text-xs text-gray-500">{c.created_by || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'kyc' ? 'Request KYC' : open === 'block' ? 'Block Customer' : open === 'risk' ? 'Mark High Risk' : open === 'refund' ? 'Record Refund' : 'Add Suspicious Note'} testId={`comp-modal-${open}`}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Customer">
            <select required className="input-axistra" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} data-testid="comp-form-customer">
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_code} — {c.full_name}</option>)}
            </select>
          </Field>
          {open === 'refund' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><input required className="input-axistra" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="comp-form-amount" /></Field>
              <Field label="Currency"><select className="input-axistra" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>USD</option><option>EUR</option><option>AED</option><option>USDT</option></select></Field>
            </div>
          )}
          <Field label="Notes"><textarea rows={3} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="comp-form-notes" /></Field>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(null)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="comp-form-submit">Save Action</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
