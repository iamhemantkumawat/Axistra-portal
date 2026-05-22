import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';
import { Plug, ArrowsClockwise, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';

export default function MagnusSync() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [user, setUser] = useState('');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get('/magnus/status').then((r) => setStatus(r.data));
    api.get('/magnus/logs?limit=50').then((r) => setLogs(r.data));
  }, []);

  const lookup = async () => {
    if (!user) return;
    try {
      const { data } = await api.get(`/magnus/user/${user}`);
      setInfo(data);
      toast.success('Magnus lookup queued (placeholder)');
    } catch { toast.error('Lookup failed'); }
  };

  if (!status) return <div className="text-gray-500">Loading…</div>;

  return (
    <div>
      <PageHeader
        eyebrow="Integration"
        title="MagnusBilling Sync"
        subtitle="Direct sync with MagnusBilling for balances, credits and CDRs."
      />

      <div className="card-axistra p-6 mb-6 border-l-4 border-[var(--axistra-gold)]">
        <div className="flex items-start gap-3">
          <Warning size={22} className="text-axistra-gold mt-0.5" weight="duotone" />
          <div>
            <div className="font-display text-base font-semibold">Placeholder mode</div>
            <div className="text-sm text-gray-600 mt-1">{status.note}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="card-axistra p-6">
          <div className="label-xs">Configuration</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Base URL</span><span className="font-mono text-xs">{status.base_url}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">API Key</span><span className="font-mono text-xs">{status.api_key_preview}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Configured</span><Badge className={status.configured ? 'badge-success' : 'badge-error'}>{status.configured ? 'Yes' : 'No'}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">Mode</span><Badge className="badge-gold">{status.mode}</Badge></div>
          </div>
        </div>

        <div className="card-axistra p-6 lg:col-span-2">
          <div className="label-xs">Lookup Magnus User</div>
          <div className="mt-3 flex gap-2">
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="magnus username" className="input-axistra flex-1" data-testid="magnus-user-input" />
            <button onClick={lookup} className="btn-primary inline-flex items-center gap-2" data-testid="magnus-lookup-btn"><ArrowsClockwise size={14} /> Lookup</button>
          </div>
          {info && (
            <pre className="mt-4 bg-gray-50 border border-gray-200 rounded-md p-3 text-xs font-mono overflow-x-auto" data-testid="magnus-lookup-result">{JSON.stringify(info, null, 2)}</pre>
          )}
        </div>
      </div>

      <div className="card-axistra overflow-x-auto">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <Plug size={18} className="text-axistra-green" />
          <h3 className="font-display font-semibold">Sync Logs</h3>
        </div>
        <table className="table-axistra">
          <thead><tr><th>Date</th><th>Username</th><th>Action</th><th>Status</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan="4" className="text-center text-gray-500 py-8">No sync activity yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="text-xs">{fmtDateTime(l.created_at)}</td>
                <td className="font-mono">{l.magnus_username || '—'}</td>
                <td>{l.action}</td>
                <td><Badge className={l.status === 'success' ? 'badge-success' : l.status === 'mismatch' ? 'badge-error' : 'badge-warning'}>{l.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
