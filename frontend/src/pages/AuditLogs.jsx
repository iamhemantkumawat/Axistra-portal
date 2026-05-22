import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.get('/audit-logs?limit=500').then((r) => setLogs(r.data)); }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Trail"
        title="Audit Logs"
        subtitle="Every privileged action across the portal is recorded with actor, IP and details."
      />
      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan="6" className="text-center text-gray-500 py-10">No actions logged yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} data-testid={`audit-row-${l.id}`}>
                <td className="text-xs">{fmtDateTime(l.created_at)}</td>
                <td className="text-sm">{l.actor_email || '—'}</td>
                <td><Badge className="badge-info">{l.action}</Badge></td>
                <td className="text-xs text-gray-600">{l.entity_type}{l.entity_id ? ` · ${l.entity_id.slice(0, 8)}` : ''}</td>
                <td className="text-sm text-gray-700 max-w-md truncate">{l.details || '—'}</td>
                <td className="font-mono text-xs text-gray-500">{l.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
