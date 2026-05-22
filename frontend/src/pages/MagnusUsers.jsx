import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge } from '../components/Atoms';
import { Link } from 'react-router-dom';
import { MagnifyingGlass, ArrowsClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';

export default function MagnusUsers() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async (p = page, s = search) => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get('/magnus/users', { params: { page: p, limit, search: s || undefined } });
      if (data?.error) {
        setError(data.error); setUsers([]); setTotal(0);
      } else {
        setUsers(data.users || []); setTotal(data.total || 0);
      }
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(1, ''); /* eslint-disable-next-line */ }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <PageHeader
        eyebrow="Live from MagnusBilling"
        title="Magnus Users"
        subtitle="All users registered in MagnusBilling along with current balances. Click any user for CDR + recharge."
        actions={
          <>
            <Link to="/magnus" className="btn-secondary">← Magnus Sync</Link>
            <button onClick={() => load(page, search)} className="btn-primary inline-flex items-center gap-2" data-testid="magnus-users-refresh"><ArrowsClockwise size={14} /> Refresh</button>
          </>
        }
      />

      <div className="card-axistra p-4 mb-4 flex gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search username (starts-with)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(1, search); } }}
            className="input-axistra pl-9"
            data-testid="magnus-users-search"
          />
        </div>
        <button onClick={() => { setPage(1); load(1, search); }} className="btn-primary" data-testid="magnus-users-apply">Search</button>
      </div>

      {error && (
        <div className="card-axistra p-6 mb-4 border-l-4 border-red-500 text-sm text-red-800">
          <strong>Live API error:</strong> {error}
        </div>
      )}

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr><th>ID</th><th>Username</th><th>Name</th><th>Email</th><th className="text-right">Credit</th><th>Plan</th><th>Active</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="9" className="text-center py-10 text-gray-500">Loading from Magnus…</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan="9" className="text-center py-10 text-gray-500">No users found.</td></tr>}
            {users.map((u) => (
              <tr key={u.id} data-testid={`magnus-user-row-${u.id}`}>
                <td className="font-mono text-xs">{u.id}</td>
                <td className="font-mono font-semibold text-axistra-green">{u.username}</td>
                <td>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                <td className="text-xs">{u.email || '—'}</td>
                <td className="text-right font-mono font-semibold">{u.credit ? parseFloat(u.credit).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                <td className="text-xs">{u.plan_id ?? '—'}</td>
                <td><Badge className={String(u.active) === '1' ? 'badge-success' : 'badge-neutral'}>{String(u.active) === '1' ? 'Active' : 'Inactive'}</Badge></td>
                <td className="text-xs text-gray-500">{u.created || '—'}</td>
                <td><Link to={`/magnus?user=${encodeURIComponent(u.username)}`} className="text-xs text-axistra-green hover:underline">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => { setPage(page - 1); load(page - 1, search); }} className="btn-secondary disabled:opacity-50" data-testid="magnus-users-prev">← Prev</button>
            <span className="px-3 py-2 text-sm">Page {page} / {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => { setPage(page + 1); load(page + 1, search); }} className="btn-secondary disabled:opacity-50" data-testid="magnus-users-next">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
