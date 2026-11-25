import React, { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, CloudArrowUp, FloppyDisk } from '@phosphor-icons/react';
import { toast } from 'sonner';
import api from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ProtectedBackupCard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const authorized = user?.role === 'admin' && user?.two_fa_enabled === true;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [backups, drive] = await Promise.all([
        api.get('/backups'), api.get('/backups/drive/status'),
      ]);
      setData({ backups: backups.data, drive: drive.data });
    } catch (err) {
      setData(null);
      setError(err.response?.status === 403
        ? 'Sign in again and complete 2FA to access backups.'
        : 'Backup status is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authorized) load();
    else setData(null);
  }, [authorized, load]);

  const create = async (mirror) => {
    setBusy(true);
    try {
      const { data: backup } = await api.post('/backups', { upload_to_drive: mirror });
      if (mirror && !backup.mirrored_to_drive) toast.warning('Local backup created. Drive upload did not complete.');
      else toast.success(mirror ? 'Backup created and mirrored to Drive' : 'Local backup created');
      await load();
    } catch (err) {
      toast.error(err.response?.status === 429 ? 'Please wait a minute before starting another backup.' : 'Backup could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const button = 'inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50';
  return (
    <section className="card-axistra p-6 lg:col-span-2" data-testid="backup-restore-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-display text-lg font-semibold">Database Backups</h3>
        {authorized && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={!data || busy || loading} onClick={() => create(false)}>
              <FloppyDisk aria-hidden="true" /> Backup Now
            </button>
            <button type="button" className={button} disabled={!data?.drive.configured || busy || loading} onClick={() => create(true)}>
              <CloudArrowUp aria-hidden="true" /> Backup + Drive
            </button>
            <button type="button" className={button} disabled={busy || loading} onClick={load} aria-label="Refresh backups" title="Refresh backups">
              <ArrowsClockwise aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {!authorized && <p className="text-sm text-gray-600">Backups are restricted to administrators signed in with 2FA.</p>}
      {authorized && error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {authorized && loading && !data && <p className="text-sm text-gray-600" role="status">Loading backup status...</p>}
      {authorized && data && (
        <>
          <p className="text-sm text-gray-600 mb-2">
            Google Drive: {data.drive.verified ? 'Upload verified' : data.drive.configured ? 'Configured, upload not yet verified' : 'Not connected'}
          </p>
          <p className="text-sm text-gray-600 mb-4">Downloads and restores are restricted to the server.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th scope="col" className="py-2 pr-4">Local snapshot</th><th scope="col" className="pr-4">Size</th><th scope="col">Created</th></tr></thead>
              <tbody>
                {data.backups.map((backup) => (
                  <tr key={backup.name} className="border-t">
                    <td className="py-2 pr-4 break-all">{backup.name}</td>
                    <td className="pr-4 whitespace-nowrap">{backup.size_human}</td>
                    <td className="whitespace-nowrap">{new Date(backup.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!data.backups.length && <tr><td className="py-2" colSpan={3}>No local snapshots found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
