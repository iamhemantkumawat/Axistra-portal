import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { Modal, Field } from './Atoms';
import { CurrencyCircleDollar, IdentificationBadge, ClockClockwise, Copy, ArrowSquareOut, FileText, CheckCircle, XCircle, Clock } from '@phosphor-icons/react';
import { toast } from 'sonner';

const fmtAed = (n, currency = 'AED') => `${currency} ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const TYPE_META = {
  initial_offer:    { label: 'Initial Offer',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  salary_change:    { label: 'Salary Change',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  position_change:  { label: 'Position Change',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  termination:      { label: 'Termination',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

const SIGN_META = {
  pending:    { label: 'Pending signature', cls: 'bg-gray-100 text-gray-700', icon: Clock },
  agreed:     { label: 'Signed — agreed',   cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle },
  declined:   { label: 'Signed — declined', cls: 'bg-red-50 text-red-700', icon: XCircle },
  superseded: { label: 'Superseded',         cls: 'bg-gray-50 text-gray-500', icon: Clock },
};

/**
 * Tab content shown inside the Edit Employee modal:
 *   • "Change Salary" / "Change Position" buttons (dedicated flows)
 *   • Timeline of all `employment_changes` for this employee
 *   • Copy/share sign URL + view letter PDF inline
 */
export default function EmploymentHistory({ employee, apiBase, onSalaryOrPositionChanged }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/payroll/employees/${employee.id}/history`);
      setHistory(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (employee?.id) reload(); /* eslint-disable-next-line */ }, [employee?.id]);

  const copySignUrl = (token) => {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Sign URL copied — send to the employee');
  };

  const fetchSignTokenForChange = async (changeId) => {
    // Token is not exposed in /history; fetch the freshly-issued one from /changes/:id
    try {
      const { data } = await api.get(`/payroll/changes/${changeId}`);
      return data.sign_url_path?.split('/').pop() || null;
    } catch { return null; }
  };

  const openLetter = async (changeId) => {
    const token = localStorage.getItem('axistra_token');
    const res = await fetch(`${apiBase}/payroll/changes/${changeId}/letter.pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { toast.error('Letter not available'); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  };

  return (
    <div className="space-y-4" data-testid="employment-history-pane">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSalaryOpen(true)}
          className="btn-primary inline-flex items-center gap-2"
          data-testid="open-change-salary-btn"
        >
          <CurrencyCircleDollar size={16} weight="duotone" /> Change Salary
        </button>
        <button
          onClick={() => setPositionOpen(true)}
          className="btn-primary inline-flex items-center gap-2 bg-amber-700 hover:bg-amber-800"
          data-testid="open-change-position-btn"
        >
          <IdentificationBadge size={16} weight="duotone" /> Change Position
        </button>
        <div className="text-xs text-gray-500 self-center ml-2">
          These actions are tracked separately from normal info edits and generate a signed letter the employee must counter-sign.
        </div>
      </div>

      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center gap-2 mb-3">
          <ClockClockwise size={14} weight="duotone" className="text-axistra-green" />
          <h4 className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Employment Timeline</h4>
        </div>

        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {!loading && history.length === 0 && (
          <div className="text-sm text-gray-500">No changes recorded yet.</div>
        )}

        <ol className="space-y-3">
          {history.map((c) => {
            const t = TYPE_META[c.change_type] || { label: c.change_type, cls: 'bg-gray-100 text-gray-700' };
            const s = SIGN_META[c.sign_status] || SIGN_META.pending;
            const SignIcon = s.icon;
            return (
              <li key={c.id} className="border border-gray-200 rounded-md p-3" data-testid={`change-row-${c.reference_number}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider font-bold border rounded-full px-2 py-0.5 ${t.cls}`}>{t.label}</span>
                      <span className="text-xs font-mono text-gray-400">{c.reference_number}</span>
                      <span className="text-xs text-gray-500">eff. {fmtDate(c.effective_date)}</span>
                    </div>
                    <div className="text-sm mt-1 text-gray-800">
                      {c.change_type === 'salary_change' && (
                        <span>Salary <span className="font-mono">{fmtAed(c.old_salary, c.salary_currency)}</span> → <span className="font-mono font-semibold text-axistra-green">{fmtAed(c.new_salary, c.salary_currency)}</span></span>
                      )}
                      {c.change_type === 'position_change' && (
                        <span><span className="line-through text-gray-400">{c.old_position}</span> → <span className="font-semibold">{c.new_position}</span></span>
                      )}
                      {c.change_type === 'initial_offer' && (
                        <span><strong>{c.new_position}</strong> · starting at <span className="font-mono">{fmtAed(c.new_salary, c.salary_currency)}</span></span>
                      )}
                    </div>
                    {c.reason && <div className="text-xs text-gray-500 mt-1">{c.reason}</div>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 ${s.cls}`}>
                      <SignIcon size={12} weight="duotone" /> {s.label}
                    </span>
                    {c.change_type !== 'initial_offer' && (
                      <button
                        onClick={() => openLetter(c.id)}
                        className="text-axistra-green hover:underline inline-flex items-center gap-1 text-xs"
                        data-testid={`view-letter-${c.reference_number}`}
                      ><FileText size={12} /> Letter</button>
                    )}
                    {c.sign_status === 'pending' && c.has_sign_token && (
                      <button
                        onClick={async () => {
                          const tok = await fetchSignTokenForChange(c.id);
                          if (tok) copySignUrl(tok);
                          else toast.error('Token unavailable');
                        }}
                        className="text-axistra-green hover:underline inline-flex items-center gap-1 text-xs"
                        data-testid={`copy-sign-url-${c.reference_number}`}
                        title="Copy the sign link to send to the employee"
                      ><Copy size={12} /> Sign URL</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <SalaryChangeModal
        open={salaryOpen}
        onClose={() => setSalaryOpen(false)}
        employee={employee}
        onSaved={(c) => { setSalaryOpen(false); reload(); onSalaryOrPositionChanged?.(c); }}
      />
      <PositionChangeModal
        open={positionOpen}
        onClose={() => setPositionOpen(false)}
        employee={employee}
        onSaved={(c) => { setPositionOpen(false); reload(); onSalaryOrPositionChanged?.(c); }}
      />
    </div>
  );
}

function SalaryChangeModal({ open, onClose, employee, onSaved }) {
  const [newSalary, setNewSalary] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => {
    // Default to first day of next month
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [signUrl, setSignUrl] = useState(null);

  useEffect(() => { if (open) { setNewSalary(''); setReason(''); setSignUrl(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/payroll/employees/${employee.id}/change-salary`, {
        new_salary: newSalary,
        effective_date: effectiveDate,
        reason,
      });
      toast.success(`Salary revision created · ${data.reference_number}`);
      // Show the sign URL right after creation so the user can copy + share
      const token = data.sign_url_path?.split('/').pop();
      if (token) setSignUrl(`${window.location.origin}/sign/${token}`);
      onSaved?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Salary change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Change Salary — ${employee?.full_name || ''}`} testId="change-salary-modal">
      {signUrl ? (
        <div className="space-y-4">
          <div className="rounded-md border-l-4 border-emerald-400 bg-emerald-50 p-4 text-sm text-emerald-900">
            ✅ Salary revision letter generated. Share this private link with <strong>{employee?.full_name}</strong> so they can review and counter-sign:
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs break-all" data-testid="sign-url-display">{signUrl}</div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { navigator.clipboard.writeText(signUrl); toast.success('Copied'); }} className="btn-secondary inline-flex items-center gap-2"><Copy size={14}/> Copy link</button>
            <button onClick={() => window.open(signUrl, '_blank', 'noopener')} className="btn-secondary inline-flex items-center gap-2"><ArrowSquareOut size={14}/> Preview</button>
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="text-sm text-gray-700">
            Current salary: <span className="font-mono font-semibold">{fmtAed(employee?.monthly_salary, employee?.salary_currency)}</span>
            &nbsp;·&nbsp; Effective from the date below this letter <strong>replaces</strong> the previous terms.
          </div>
          <Field label={`New Monthly Salary (${employee?.salary_currency || 'AED'})`}>
            <input
              type="number" step="0.01" required min="0"
              value={newSalary}
              onChange={(e) => setNewSalary(e.target.value)}
              className="input-axistra font-mono"
              placeholder={String(employee?.monthly_salary || '0')}
              data-testid="new-salary-input"
            />
          </Field>
          <Field label="Effective Date">
            <input
              type="date" required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="input-axistra"
              data-testid="salary-effective-date"
            />
          </Field>
          <Field label="Reason (optional, shown on letter)">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input-axistra"
              placeholder="e.g. Performance review · scope expansion · promotion"
              data-testid="salary-reason-input"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary" data-testid="submit-salary-change-btn">
              {busy ? 'Generating letter…' : 'Create Revision Letter'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PositionChangeModal({ open, onClose, employee, onSaved }) {
  const [newPosition, setNewPosition] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [signUrl, setSignUrl] = useState(null);

  useEffect(() => { if (open) { setNewPosition(''); setReason(''); setSignUrl(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(`/payroll/employees/${employee.id}/change-position`, {
        new_position: newPosition,
        effective_date: effectiveDate,
        reason,
      });
      toast.success(`Position change recorded · ${data.reference_number}`);
      const token = data.sign_url_path?.split('/').pop();
      if (token) setSignUrl(`${window.location.origin}/sign/${token}`);
      onSaved?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Position change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Change Position — ${employee?.full_name || ''}`} testId="change-position-modal">
      {signUrl ? (
        <div className="space-y-4">
          <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
            ✅ Position change letter generated. Share this link with <strong>{employee?.full_name}</strong>:
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs break-all" data-testid="sign-url-display">{signUrl}</div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { navigator.clipboard.writeText(signUrl); toast.success('Copied'); }} className="btn-secondary inline-flex items-center gap-2"><Copy size={14}/> Copy link</button>
            <button onClick={() => window.open(signUrl, '_blank', 'noopener')} className="btn-secondary inline-flex items-center gap-2"><ArrowSquareOut size={14}/> Preview</button>
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="text-sm text-gray-700">
            Current position: <span className="font-semibold">{employee?.position}</span>
          </div>
          <Field label="New Position">
            <input
              type="text" required
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              className="input-axistra"
              placeholder="e.g. Group CEO"
              data-testid="new-position-input"
            />
          </Field>
          <Field label="Effective Date">
            <input
              type="date" required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="input-axistra"
              data-testid="position-effective-date"
            />
          </Field>
          <Field label="Reason (optional, shown on letter)">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input-axistra"
              placeholder="e.g. Promotion · scope change · organizational restructure"
              data-testid="position-reason-input"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary bg-amber-700 hover:bg-amber-800" data-testid="submit-position-change-btn">
              {busy ? 'Generating letter…' : 'Create Position Letter'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
