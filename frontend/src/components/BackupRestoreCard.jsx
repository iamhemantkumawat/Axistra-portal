import React, { useEffect, useRef, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { Modal, Field } from './Atoms';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import {
  CloudArrowUp, CloudArrowDown, Trash, ArrowsClockwise, Download,
  FileArrowUp, ShieldWarning, GoogleLogo, FloppyDisk,
} from '@phosphor-icons/react';

const CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_REPLACES_ALL_DATA';

export default function BackupRestoreCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [local, setLocal] = useState([]);
  const [drive, setDrive] = useState({ configured: false });
  const [driveFiles, setDriveFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null); // { name, source: 'local'|'drive', driveId? }
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const uploadInputRef = useRef(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [localRes, statusRes] = await Promise.all([
        api.get('/backups'),
        api.get('/backups/drive/status'),
      ]);
      setLocal(localRes.data || []);
      setDrive(statusRes.data || { configured: false });
      if (statusRes.data?.configured) {
        try {
          const r = await api.get('/backups/drive/list');
          setDriveFiles(r.data || []);
        } catch (err) {
          setDriveFiles([]);
        }
      } else {
        setDriveFiles([]);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) loadAll(); /* eslint-disable-next-line */ }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="card-axistra p-6 lg:col-span-2" data-testid="backup-restore-card">
        <h3 className="font-display text-lg font-semibold mb-2">Backup &amp; Restore</h3>
        <p className="text-sm text-gray-500">Only administrators can access database backups. Contact an admin if you need a snapshot.</p>
      </div>
    );
  }

  const handleBackupNow = async (uploadToDrive) => {
    setBusyAction(uploadToDrive ? 'backup-drive' : 'backup-local');
    try {
      const { data } = await api.post('/backups', { upload_to_drive: !!uploadToDrive });
      if (uploadToDrive && !data.drive) {
        toast.warning(`Backup created locally but Drive upload was skipped. ${drive.configured ? 'Check server logs.' : 'Drive is not configured.'}`);
      } else if (uploadToDrive && data.drive) {
        toast.success(`Backup created and uploaded to Drive (${data.drive.id})`);
      } else {
        toast.success(`Backup created: ${data.name}`);
      }
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Backup failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownload = async (name) => {
    const token = localStorage.getItem('axistra_token');
    const url = `${API_BASE}/backups/${encodeURIComponent(name)}/download`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error('Download failed');
    }
  };

  const handleDeleteLocal = async (name) => {
    if (!window.confirm(`Delete local backup "${name}"? This cannot be undone.`)) return;
    setBusyAction(`del-${name}`);
    try {
      await api.delete(`/backups/${encodeURIComponent(name)}`);
      toast.success('Local backup deleted');
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePushToDrive = async (name) => {
    setBusyAction(`drive-up-${name}`);
    try {
      const { data } = await api.post(`/backups/${encodeURIComponent(name)}/upload-to-drive`);
      toast.success(`Uploaded to Drive (${data.id})`);
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Drive upload failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteDrive = async (file) => {
    if (!window.confirm(`Delete "${file.name}" from Google Drive? The local copy (if any) stays.`)) return;
    setBusyAction(`drive-del-${file.id}`);
    try {
      await api.delete(`/backups/drive/${file.id}`);
      toast.success('Removed from Drive');
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Drive delete failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePullFromDrive = async (file) => {
    setBusyAction(`drive-pull-${file.id}`);
    try {
      const { data } = await api.post(`/backups/drive/${file.id}/pull`, { name: file.name });
      toast.success(`Pulled ${data.name} from Drive`);
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Drive pull failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(sql|dump)\.gz$/i.test(file.name)) {
      toast.error('Only .sql.gz or .dump.gz files are supported');
      return;
    }
    setBusyAction('upload');
    const form = new FormData();
    form.append('file', file);
    try {
      const token = localStorage.getItem('axistra_token');
      const res = await fetch(`${API_BASE}/backups/upload`, {
        method: 'POST', body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Upload failed');
      }
      toast.success('Backup file uploaded — it is now in the local list');
      loadAll();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setBusyAction(null);
    }
  };

  const startRestore = (row, source = 'local') => {
    setRestoreTarget({ name: row.name, source, driveId: row.id });
    setConfirmText('');
  };

  const confirmRestore = async () => {
    if (confirmText !== CONFIRM_PHRASE) {
      toast.error('Confirmation phrase does not match');
      return;
    }
    setRestoring(true);
    try {
      let nameToRestore = restoreTarget.name;
      if (restoreTarget.source === 'drive') {
        // First pull it down, then restore
        const { data } = await api.post(`/backups/drive/${restoreTarget.driveId}/pull`, { name: restoreTarget.name });
        nameToRestore = data.name;
      }
      const { data } = await api.post(
        `/backups/${encodeURIComponent(nameToRestore)}/restore`,
        { confirm: CONFIRM_PHRASE },
      );
      toast.success(`Database restored. Safety snapshot: ${data.safety_snapshot}`);
      setRestoreTarget(null);
      setConfirmText('');
      loadAll();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="card-axistra p-6 lg:col-span-2" data-testid="backup-restore-card">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-semibold">Backup &amp; Restore</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            Full PostgreSQL dump (every table, every row). Scheduled snapshot runs daily at 02:00 UTC.
            Restore replaces the entire database — a safety snapshot is captured automatically before the swap.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => handleBackupNow(false)}
            disabled={busyAction === 'backup-local'}
            className="btn-secondary inline-flex items-center gap-2"
            data-testid="backup-now-btn"
          >
            <FloppyDisk size={16} /> {busyAction === 'backup-local' ? 'Snapshotting…' : 'Backup Now'}
          </button>
          <button
            onClick={() => handleBackupNow(true)}
            disabled={busyAction === 'backup-drive' || !drive.configured}
            title={drive.configured ? 'Backup and push to Google Drive' : 'Google Drive not configured'}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="backup-and-drive-btn"
          >
            <CloudArrowUp size={16} /> {busyAction === 'backup-drive' ? 'Uploading…' : 'Backup + Drive'}
          </button>
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={busyAction === 'upload'}
            className="btn-secondary inline-flex items-center gap-2"
            data-testid="upload-dump-btn"
          >
            <FileArrowUp size={16} /> {busyAction === 'upload' ? 'Uploading…' : 'Upload .sql.gz'}
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".gz,application/gzip"
            onChange={handleUploadFile}
            className="hidden"
            data-testid="upload-dump-input"
          />
          <button
            onClick={loadAll}
            disabled={loading}
            className="btn-secondary inline-flex items-center gap-2"
            title="Refresh"
            data-testid="backup-refresh-btn"
          >
            <ArrowsClockwise size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <DriveStatus drive={drive} />

      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-sm text-gray-700">Local backups</h4>
          <span className="text-xs text-gray-400">{local.length} file{local.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-axistra">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Size</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {local.length === 0 && (
                <tr><td colSpan={5} className="text-center text-gray-400 py-6">No local snapshots yet. Click “Backup Now”.</td></tr>
              )}
              {local.map((b) => (
                <tr key={b.name} data-testid={`backup-row-${b.name}`}>
                  <td className="font-mono text-xs">{b.name}</td>
                  <td>
                    <span className={`badge ${b.kind === 'scheduled' ? 'badge-neutral' : 'badge-success'}`}>{b.kind}</span>
                  </td>
                  <td className="font-mono text-xs text-gray-600">{b.size_human}</td>
                  <td className="text-xs text-gray-500">{new Date(b.created_at).toLocaleString()}</td>
                  <td className="text-right">
                    <button onClick={() => handleDownload(b.name)} className="text-gray-500 hover:text-axistra-green p-1" title="Download" data-testid={`backup-download-${b.name}`}>
                      <Download size={16} />
                    </button>
                    {drive.configured && (
                      <button
                        onClick={() => handlePushToDrive(b.name)}
                        disabled={busyAction === `drive-up-${b.name}`}
                        className="text-gray-500 hover:text-blue-600 p-1 ml-1"
                        title="Upload to Google Drive"
                        data-testid={`backup-push-drive-${b.name}`}
                      >
                        <CloudArrowUp size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => startRestore(b, 'local')}
                      className="text-gray-500 hover:text-orange-600 p-1 ml-1"
                      title="Restore this backup (wipe + replace)"
                      data-testid={`backup-restore-${b.name}`}
                    >
                      <ShieldWarning size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteLocal(b.name)}
                      disabled={busyAction === `del-${b.name}`}
                      className="text-gray-500 hover:text-red-600 p-1 ml-1"
                      title="Delete local copy"
                      data-testid={`backup-delete-${b.name}`}
                    >
                      <Trash size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drive.configured && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm text-gray-700 inline-flex items-center gap-2">
              <GoogleLogo size={16} /> Google Drive backups
            </h4>
            <span className="text-xs text-gray-400">{driveFiles.length} file{driveFiles.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-axistra">
              <thead>
                <tr><th>Name</th><th>Size</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {driveFiles.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-gray-400 py-6">No files in the configured Drive folder yet.</td></tr>
                )}
                {driveFiles.map((f) => (
                  <tr key={f.id} data-testid={`drive-row-${f.id}`}>
                    <td className="font-mono text-xs">{f.name}</td>
                    <td className="font-mono text-xs text-gray-600">{f.size ? `${(Number(f.size) / 1024 / 1024).toFixed(2)} MB` : '—'}</td>
                    <td className="text-xs text-gray-500">{f.created_time ? new Date(f.created_time).toLocaleString() : '—'}</td>
                    <td className="text-right">
                      {f.web_view_link && (
                        <a href={f.web_view_link} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-axistra-green p-1 inline-block" title="Open in Drive">
                          <Download size={16} />
                        </a>
                      )}
                      <button
                        onClick={() => handlePullFromDrive(f)}
                        disabled={busyAction === `drive-pull-${f.id}`}
                        className="text-gray-500 hover:text-axistra-green p-1 ml-1"
                        title="Pull this file down to the server"
                        data-testid={`drive-pull-${f.id}`}
                      >
                        <CloudArrowDown size={16} />
                      </button>
                      <button
                        onClick={() => startRestore(f, 'drive')}
                        className="text-gray-500 hover:text-orange-600 p-1 ml-1"
                        title="Pull + Restore"
                        data-testid={`drive-restore-${f.id}`}
                      >
                        <ShieldWarning size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteDrive(f)}
                        disabled={busyAction === `drive-del-${f.id}`}
                        className="text-gray-500 hover:text-red-600 p-1 ml-1"
                        title="Delete from Drive"
                        data-testid={`drive-delete-${f.id}`}
                      >
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!restoreTarget}
        onClose={() => { setRestoreTarget(null); setConfirmText(''); }}
        title="Confirm full database restore"
        testId="restore-modal"
      >
        {restoreTarget && (
          <div className="space-y-4">
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <div className="font-semibold mb-1 flex items-center gap-2"><ShieldWarning size={16} /> This action is destructive</div>
              <p>
                The current database will be <b>wiped</b> and replaced with the contents of:
              </p>
              <p className="font-mono text-xs mt-2 break-all">{restoreTarget.name}</p>
              <p className="mt-2 text-xs">
                A safety snapshot of the current state is captured automatically before the restore, so you can roll back if needed.
              </p>
            </div>
            <Field label={`Type the phrase below exactly to confirm`}>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="input-axistra font-mono text-xs"
                data-testid="restore-confirm-input"
              />
              <p className="text-[11px] text-gray-500 mt-1 font-mono">{CONFIRM_PHRASE}</p>
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRestoreTarget(null); setConfirmText(''); }} className="btn-secondary">Cancel</button>
              <button
                onClick={confirmRestore}
                disabled={confirmText !== CONFIRM_PHRASE || restoring}
                className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
                data-testid="restore-confirm-btn"
              >
                {restoring ? 'Restoring…' : 'Wipe & Restore'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DriveStatus({ drive }) {
  if (drive?.configured) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 flex items-start gap-2">
        <GoogleLogo size={16} className="mt-0.5" />
        <div>
          <div className="font-semibold">Google Drive uploads are active</div>
          <div className="font-mono text-[11px] mt-1 break-all">
            Service account: {drive.service_account_email || '—'} · Folder: {drive.folder_id}
          </div>
          <div className="mt-1">Scheduled snapshots are auto-mirrored to Drive. Use “Backup + Drive” to mirror a manual snapshot immediately.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <div className="font-semibold flex items-center gap-2"><GoogleLogo size={16} /> Google Drive is not configured</div>
      <div className="mt-1 leading-relaxed">
        Local backups still work. To enable Drive mirroring, set two env vars on the server and restart the backend:
        <ul className="list-disc ml-5 mt-1">
          <li><code className="font-mono">GOOGLE_DRIVE_FOLDER_ID</code> — the destination folder ID</li>
          <li><code className="font-mono">GOOGLE_SERVICE_ACCOUNT_KEY_JSON</code> — the full service-account JSON key (single line)</li>
        </ul>
        Then share that Drive folder with the service-account email and grant <i>Editor</i> access.
        {drive?.last_error && <div className="mt-1 text-[11px] font-mono">Last error: {drive.last_error}</div>}
      </div>
    </div>
  );
}
