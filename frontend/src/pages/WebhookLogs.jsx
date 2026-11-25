import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { Badge, Hash, KpiCard, Modal, PageHeader } from '../components/Atoms';
import { fmtDateTime } from '../lib/format';
import { ArrowsClockwise, CheckCircle, WarningCircle, PauseCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';

const SOURCE_LABELS = {
  btcpay: 'BTCPay',
  oxapay: 'OxaPay',
  telegram_manual: 'Telegram Bot',
  manual: 'Manual',
};

function prettyPayload(detail) {
  if (!detail) return '';
  if (detail.payload) return JSON.stringify(detail.payload, null, 2);
  return detail.raw_payload || '';
}

function sourceBadge(source) {
  if (source === 'btcpay') return 'badge-info';
  if (source === 'oxapay') return 'badge-success';
  if (source === 'telegram_manual') return 'badge-warning';
  return 'badge-neutral';
}

export default function WebhookLogs() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, by_source: [] });
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState('all');
  const [processed, setProcessed] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState('all');
  const [confirm, setConfirm] = useState(null);
  const [releasing, setReleasing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (source !== 'all') params.source = source;
      if (view === 'paused') params.processed = 'paused';
      else if (processed !== 'all') params.processed = processed;
      if (q.trim()) params.q = q.trim();
      const [logsRes, statsRes] = await Promise.all([
        api.get('/webhooks/logs', { params }),
        api.get('/webhooks/logs/stats'),
      ]);
      setRows(logsRes.data.rows || []);
      setTotal(logsRes.data.total || 0);
      setStats(statsRes.data || { total: 0, by_source: [] });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load webhook logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [source, processed, view]);

  const pausedCount = useMemo(
    () => stats.by_source?.reduce((sum, item) => sum + Number(item.paused || 0), 0) || 0,
    [stats],
  );

  const openConfirm = async (id) => {
    try {
      const { data } = await api.get(`/webhooks/logs/${id}`);
      setConfirm(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load paused payment');
    }
  };

  const releaseNow = async () => {
    setReleasing(true);
    try {
      const { data } = await api.post(`/webhooks/logs/${confirm.id}/release`);
      toast.success(data.duplicate ? 'Already recorded — linked to existing recharge' : `Entry created${data.invoice_number ? ` — invoice ${data.invoice_number}` : ''}`);
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create entry');
    } finally {
      setReleasing(false);
    }
  };

  const errorCount = useMemo(
    () => stats.by_source?.reduce((sum, item) => sum + Number(item.errors || 0), 0) || 0,
    [stats],
  );
  const processedCount = useMemo(
    () => stats.by_source?.reduce((sum, item) => sum + Number(item.processed || 0), 0) || 0,
    [stats],
  );

  const openDetail = async (id) => {
    try {
      const { data } = await api.get(`/webhooks/logs/${id}`);
      setDetail(data);
      setDetailOpen(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to open webhook payload');
    }
  };

  const copyPayload = async () => {
    if (!detail) return;
    await navigator.clipboard.writeText(prettyPayload(detail));
    toast.success('Webhook payload copied');
  };

  return (
    <div>
      <PageHeader
        eyebrow="Integrations"
        title="Webhook Logs"
        subtitle="Every received BTCPay, OxaPay, Telegram bot, and manual gateway webhook is stored here with raw metadata for debugging and audit checks."
        actions={<button onClick={load} className="btn-secondary inline-flex items-center gap-2"><ArrowsClockwise size={16} /> Refresh</button>}
      />

      <div className="flex gap-2 mb-4 border-b border-gray-200" role="tablist" data-testid="webhook-view-tabs">
        {[{ k: 'all', l: 'All Webhooks' }, { k: 'paused', l: `Paused (${pausedCount})` }].map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={view === t.k}
            onClick={() => setView(t.k)}
            className={`px-4 py-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors ${view === t.k ? 'border-axistra-green text-axistra-green' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
            data-testid={`webhook-tab-${t.k}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {view === 'paused' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 mb-4 text-sm text-amber-800 flex items-start gap-2" data-testid="paused-info">
          <PauseCircle size={18} className="flex-shrink-0 mt-0.5" />
          <div>These payments arrived while Gateway Recharge Intake was OFF (Settings → Payments). No customer, recharge or invoice was created. Use <strong>Create entry now</strong> to record one manually.</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <KpiCard label="Total Webhooks" value={stats.total || 0} sub={`${total} matching current filters`} icon={ArrowsClockwise} />
        <KpiCard label="Processed" value={processedCount} sub="Created, ignored, or duplicate-linked" accent icon={CheckCircle} />
        <KpiCard label="Errors" value={errorCount} sub="Webhook rows with processing notes/errors" icon={WarningCircle} />
      </div>

      <div className="card-axistra p-4 mb-4 grid grid-cols-1 md:grid-cols-[1fr_180px_180px_auto] gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search invoice ID, event ID, TX hash, recharge ID, or raw payload..."
          className="input-axistra"
          data-testid="webhook-search-input"
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} className="input-axistra" data-testid="webhook-source-filter">
          <option value="all">All sources</option>
          <option value="btcpay">BTCPay</option>
          <option value="oxapay">OxaPay</option>
          <option value="telegram_manual">Telegram Bot</option>
          <option value="manual">Manual</option>
        </select>
        <select value={processed} onChange={(e) => setProcessed(e.target.value)} disabled={view === 'paused'} className="input-axistra" data-testid="webhook-processed-filter">
          <option value="all">All statuses</option>
          <option value="true">Processed</option>
          <option value="false">Unprocessed / Error</option>
        </select>
        <button onClick={load} disabled={loading} className="btn-primary">{loading ? 'Loading...' : 'Apply'}</button>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead>
            <tr>
              <th>Received</th>
              <th>Source</th>
              <th>Gateway Invoice / Event</th>
              <th>TX Hash</th>
              <th>Recharge</th>
              <th>Status</th>
              <th>Payload</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="8" className="text-center text-gray-500 py-10">No webhook logs found.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} data-testid={`webhook-row-${row.id}`}>
                <td className="text-xs text-gray-600 whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                <td><Badge className={sourceBadge(row.source)}>{SOURCE_LABELS[row.source] || row.source}</Badge></td>
                <td className="text-xs">
                  <div className="font-mono text-gray-900">{row.gateway_invoice_id || '—'}</div>
                  <div className="font-mono text-gray-500 max-w-xs truncate">{row.external_event_id || '—'}</div>
                </td>
                <td><Hash value={row.tx_hash} /></td>
                <td className="font-mono text-xs text-gray-600">{row.recharge_id ? row.recharge_id.slice(0, 8) : '—'}</td>
                <td>
                  {String(row.error_message || '').startsWith('PAUSED:') && !row.processed
                    ? <Badge className="badge-warning">Paused</Badge>
                    : row.error_message
                    ? <Badge className="badge-warning">Note</Badge>
                    : row.processed
                      ? <Badge className="badge-success">Processed</Badge>
                      : <Badge className="badge-neutral">Pending</Badge>}
                  {row.error_message && <div className="text-[11px] text-amber-700 max-w-xs truncate mt-1">{row.error_message}</div>}
                </td>
                <td className="font-mono text-xs text-gray-500">{row.raw_payload_size || 0} chars</td>
                <td className="text-right whitespace-nowrap">
                  {String(row.error_message || '').startsWith('PAUSED:') && !row.processed && (
                    <button onClick={() => openConfirm(row.id)} className="btn-primary text-xs mr-2" data-testid={`webhook-release-${row.id}`}>Create entry now</button>
                  )}
                  <button onClick={() => openDetail(row.id)} className="btn-secondary text-xs" data-testid={`webhook-view-${row.id}`}>View JSON</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Create entry from paused payment?" testId="webhook-release-modal">
        {confirm && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="label-xs">Gateway</div><div>{confirm.preview?.payment_gateway || SOURCE_LABELS[confirm.source]}</div></div>
              <div><div className="label-xs">Received</div><div>{fmtDateTime(confirm.created_at)}</div></div>
              <div><div className="label-xs">Amount</div><div className="font-mono font-semibold" data-testid="release-amount">{confirm.preview?.amount || '—'} {confirm.preview?.currency || ''}</div></div>
              <div><div className="label-xs">Crypto</div><div className="font-mono">{confirm.preview?.crypto_amount || '—'} {confirm.preview?.crypto_coin || ''}</div></div>
              <div><div className="label-xs">Magnus User</div><div className="font-mono" data-testid="release-magnus">{confirm.preview?.magnus_username || '—'}</div></div>
              <div><div className="label-xs">Customer</div><div>{confirm.preview?.full_name || confirm.preview?.email || '—'}</div></div>
              <div className="col-span-2"><div className="label-xs">Gateway Invoice / TX</div><div className="font-mono text-xs break-all">{confirm.preview?.gateway_invoice_id || '—'} · {confirm.preview?.tx_hash || 'no TX yet'}</div></div>
            </div>
            {confirm.preview && !confirm.preview.paid && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">The gateway did not mark this payment as paid yet — the recharge will be created as pending.</div>
            )}
            <p className="text-xs text-gray-500">This creates the customer (if new), recharge and invoice exactly like a normal webhook, even though intake is OFF.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="btn-secondary" data-testid="release-cancel">Cancel</button>
              <button type="button" onClick={releaseNow} disabled={releasing} className="btn-primary" data-testid="release-confirm">{releasing ? 'Creating…' : 'Yes, create entry'}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Webhook Payload" size="xl" testId="webhook-detail-modal">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><div className="label-xs">Source</div><Badge className={sourceBadge(detail.source)}>{SOURCE_LABELS[detail.source] || detail.source}</Badge></div>
              <div><div className="label-xs">Received</div><div>{fmtDateTime(detail.created_at)}</div></div>
              <div><div className="label-xs">Processed</div><div>{detail.processed ? 'Yes' : 'No'}</div></div>
              <div><div className="label-xs">Gateway Invoice</div><div className="font-mono text-xs">{detail.gateway_invoice_id || '—'}</div></div>
              <div><div className="label-xs">Event ID</div><div className="font-mono text-xs break-all">{detail.external_event_id || '—'}</div></div>
              <div><div className="label-xs">Recharge ID</div><div className="font-mono text-xs">{detail.recharge_id || '—'}</div></div>
            </div>
            {detail.error_message && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{detail.error_message}</div>
            )}
            <div className="flex items-center justify-between">
              <div className="label-xs">Raw JSON Payload</div>
              <button onClick={copyPayload} className="btn-secondary text-xs">Copy JSON</button>
            </div>
            <pre className="max-h-[52vh] overflow-auto rounded bg-gray-950 p-4 text-xs leading-relaxed text-gray-100">{prettyPayload(detail)}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
