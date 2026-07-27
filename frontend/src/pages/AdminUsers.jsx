import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Modal, Field, Badge } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';
import { Plus } from '@phosphor-icons/react';
import { toast } from 'sonner';

export default function AdminUsers() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'admin' });

  const load = () => api.get('/auth/admins').then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/admins', form);
      toast.success('Admin user created');
      setOpen(false); setForm({ email: '', password: '', full_name: '', role: 'admin' }); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Access"
        title="Admin Users"
        subtitle="Manage portal access. Roles: Admin (full), Accountant, Auditor."
        actions={<button onClick={() => setOpen(true)} className="btn-primary inline-flex items-center gap-2" data-testid="add-admin-btn"><Plus size={16} /> Add Admin</button>}
      />
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>2FA</th><th>Active</th><th>Last Login</th></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} data-testid={`admin-row-${u.email}`}>
                <td className="font-medium">{u.email}</td>
                <td>{u.full_name}</td>
                <td><Badge className="badge-info">{u.role}</Badge></td>
                <td><Badge className={u.two_fa_enabled ? 'badge-success' : 'badge-warning'}>{u.two_fa_enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                <td><Badge className={u.is_active ? 'badge-success' : 'badge-error'}>{u.is_active ? 'Yes' : 'No'}</Badge></td>
                <td className="text-xs text-gray-500">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Create Admin User" testId="admin-modal">
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label="Email *" span={2}><input required type="email" className="input-axistra" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="admin-form-email" /></Field>
          <Field label="Password *"><input required type="password" className="input-axistra" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="admin-form-password" /></Field>
          <Field label="Full Name"><input className="input-axistra" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="admin-form-name" /></Field>
          <Field label="Role" span={2}>
            <select className="input-axistra" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="admin-form-role">
              <option value="admin">Admin</option><option value="accountant">Accountant</option><option value="auditor">Auditor</option><option value="chartered_accountant">Chartered Accountant (CA)</option>
            </select>
          </Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="admin-form-submit">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
