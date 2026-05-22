import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';
import { toast } from 'sonner';

const STATUS_META = {
  new: 'badge-warning',
  contacted: 'badge-info',
  qualified: 'badge-success',
  converted: 'badge-success',
  rejected: 'badge-neutral',
};

export default function Leads() {
  const [items, setItems] = useState([]);
  const load = () => api.get('/leads').then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/leads/${id}/status`, { status });
      toast.success('Status updated');
      load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Leads"
        subtitle="Inbound contact requests from the public landing page (axistratech.com)."
      />
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Company</th><th>Message</th><th>Status</th><th>IP</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="7" className="text-center py-10 text-gray-500">No leads yet.</td></tr>}
            {items.map((l) => (
              <tr key={l.id} data-testid={`lead-row-${l.id}`}>
                <td className="text-xs">{fmtDateTime(l.created_at)}</td>
                <td className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(' ')}</td>
                <td className="text-sm"><a href={`mailto:${l.email}`} className="text-axistra-green hover:underline">{l.email}</a></td>
                <td className="text-sm">{l.company || '—'}</td>
                <td className="text-xs text-gray-700 max-w-xs truncate" title={l.message}>{l.message || '—'}</td>
                <td>
                  <select
                    value={l.status}
                    onChange={(e) => updateStatus(l.id, e.target.value)}
                    className={`text-xs border rounded px-2 py-1 ${STATUS_META[l.status] === 'badge-success' ? 'border-green-300' : 'border-gray-200'}`}
                    data-testid={`lead-status-${l.id}`}
                  >
                    {Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="font-mono text-xs text-gray-500">{l.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
