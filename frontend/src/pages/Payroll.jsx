import React, { useEffect, useMemo, useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge, Modal, Field, EmptyState } from '../components/Atoms';
import EmploymentHistory from '../components/EmploymentHistory';
import { toast } from 'sonner';
import {
  Plus, Users, Bank, FileText, DownloadSimple, CheckCircle, CurrencyCircleDollar,
  Pencil, Trash, UploadSimple, Receipt, ArrowSquareOut,
} from '@phosphor-icons/react';

const downloadBlob = async (url, filename) => {
  const token = localStorage.getItem('axistra_token');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const openBlobInNewTab = async (url) => {
  const token = localStorage.getItem('axistra_token');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { toast.error(`HTTP ${res.status}`); return; }
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
};

const fmtAed = (n) => Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const periodLabel = (p) => {
  if (!p) return '';
  const [y, m] = p.split('-').map((s) => parseInt(s, 10));
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const RUN_STATUS_META = {
  draft:     { label: 'Draft',     cls: 'badge-neutral' },
  approved:  { label: 'Approved',  cls: 'badge-info'    },
  paid:      { label: 'Paid',      cls: 'badge-success' },
  cancelled: { label: 'Cancelled', cls: 'badge-error'   },
};

export default function Payroll() {
  const [tab, setTab] = useState('runs');
  const [employees, setEmployees] = useState([]);
  const [banks, setBanks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [emp, bk, rn] = await Promise.all([
        api.get('/payroll/employees'),
        api.get('/payroll/bank-accounts'),
        api.get('/payroll/runs'),
      ]);
      setEmployees(emp.data); setBanks(bk.data); setRuns(rn.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { loadAll(); }, []);

  return (
    <div data-testid="payroll-page">
      <PageHeader
        eyebrow="HR & FINANCE"
        title="Payroll"
        subtitle="Employees, monthly payroll runs, salary slips, board resolutions and bank transfer proofs — all linked to your P&L."
        actions={
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => downloadBlob(`${API_BASE}/payroll/register.xlsx`, `axistra-payroll-register-${new Date().toISOString().slice(0,10)}.xlsx`).catch((e)=>toast.error(e.message))}
              className="btn-secondary inline-flex items-center gap-2"
              data-testid="payroll-register-xlsx-btn"
            >
              <DownloadSimple size={16} /> Payroll Register (XLSX)
            </button>
          </div>
        }
      />

      <div className="flex border-b border-gray-200 mb-5 gap-1 overflow-x-auto">
        {[
          ['runs',      'Payroll Runs', CurrencyCircleDollar],
          ['employees', 'Employees',    Users],
          ['banks',     'Bank Accounts',Bank],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            data-testid={`payroll-tab-${key}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === key
                ? 'border-axistra-green text-axistra-green'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Icon size={16} weight="duotone" /> {label}
          </button>
        ))}
      </div>

      {tab === 'runs' && (
        <RunsTab runs={runs} employees={employees} banks={banks} onChanged={loadAll} loading={loading} />
      )}
      {tab === 'employees' && (
        <EmployeesTab items={employees} onChanged={loadAll} />
      )}
      {tab === 'banks' && (
        <BanksTab items={banks} onChanged={loadAll} />
      )}
    </div>
  );
}

// ===================================================================
// Tab: Runs
// ===================================================================
function RunsTab({ runs, employees, banks, onChanged, loading }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [bankId, setBankId] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailRun, setDetailRun] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { period };
      if (bankId) payload.paid_from_bank_id = bankId;
      if (paidAt) payload.paid_at = paidAt;
      const { data } = await api.post('/payroll/runs', payload);
      toast.success(`Created ${data.period} draft with ${data.items?.length || 0} employees`);
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create run');
    } finally { setBusy(false); }
  };

  if (loading && runs.length === 0) return <div className="text-gray-500 p-6">Loading…</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-gray-500">{runs.length} payroll run(s)</div>
        <button
          onClick={() => setCreateOpen(true)}
          className="btn-primary inline-flex items-center gap-2"
          disabled={employees.length === 0}
          data-testid="payroll-new-run-btn"
        ><Plus size={15} /> New Payroll Run</button>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="No payroll runs yet"
          hint={employees.length === 0
            ? 'Add employees first, then come back to run May 2026 payroll.'
            : 'Click "New Payroll Run" to create a draft for the current month.'}
        />
      ) : (
        <div className="card-axistra overflow-x-auto">
          <table className="table-axistra">
            <thead><tr>
              <th>Period</th><th>Status</th><th>Items</th>
              <th className="text-right">Net AED</th><th>Bank</th><th>Pay Date</th><th>Reference</th><th></th>
            </tr></thead>
            <tbody>
              {runs.map((r) => {
                const meta = RUN_STATUS_META[r.status] || RUN_STATUS_META.draft;
                return (
                  <tr key={r.id} data-testid={`payroll-run-row-${r.period}`}>
                    <td className="font-medium">{periodLabel(r.period)}<div className="text-[10px] text-gray-400">{r.period}</div></td>
                    <td><Badge className={meta.cls}>{meta.label}</Badge></td>
                    <td>{r.items_count}</td>
                    <td className="text-right font-mono">AED {fmtAed(r.total_net_aed)}</td>
                    <td>{r.paid_from_bank?.name || <span className="text-gray-400">—</span>}</td>
                    <td>{fmtDate(r.paid_at)}</td>
                    <td className="text-xs text-gray-500">{r.transfer_reference || '—'}</td>
                    <td className="text-right">
                      <button onClick={() => setDetailRun(r.id)} className="text-axistra-green hover:underline text-xs" data-testid={`payroll-run-open-${r.period}`}>Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Payroll Run" testId="new-run-modal">
        <form onSubmit={create} className="space-y-4">
          <Field label="Period (YYYY-MM)">
            <input
              type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
              required className="input-axistra"
              data-testid="run-period-input"
            />
          </Field>
          <Field label="Paid From (bank account)">
            <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="input-axistra" data-testid="run-bank-select">
              <option value="">— default ({banks.find((b)=>b.is_default_payroll)?.name || 'first active'}) —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
            </select>
          </Field>
          <Field label="Pay Date (defaults to 1st of next month)">
            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="input-axistra" data-testid="run-paid-at-input" />
          </Field>
          <p className="text-xs text-gray-500">
            All <strong>{employees.filter((e)=>e.status==='active').length} active employees</strong> will be added at their current salary. You can edit individual lines on the next screen.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary" data-testid="run-create-submit-btn">{busy ? 'Creating…' : 'Create Draft'}</button>
          </div>
        </form>
      </Modal>

      {detailRun && (
        <RunDetailModal runId={detailRun} banks={banks} onClose={() => setDetailRun(null)} onChanged={onChanged} />
      )}
    </div>
  );
}

function RunDetailModal({ runId, banks, onClose, onChanged }) {
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paidForm, setPaidForm] = useState({ paid_at: '', transfer_reference: '' });

  const load = () => api.get(`/payroll/runs/${runId}`).then((r) => {
    setRun(r.data);
    setPaidForm({
      paid_at: r.data.paid_at ? new Date(r.data.paid_at).toISOString().slice(0, 10) : '',
      transfer_reference: r.data.transfer_reference || '',
    });
  });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [runId]);

  if (!run) return (
    <Modal open onClose={onClose} title="Loading…" size="xl"><div className="text-gray-500">Loading run…</div></Modal>
  );

  const meta = RUN_STATUS_META[run.status] || RUN_STATUS_META.draft;
  const isDraft = run.status === 'draft';
  const isApproved = run.status === 'approved';
  const isPaid = run.status === 'paid';
  const editable = !isPaid && run.status !== 'cancelled';

  const updateBank = async (bank_id) => {
    setBusy(true);
    try {
      await api.patch(`/payroll/runs/${runId}`, { paid_from_bank_id: bank_id || null });
      await load(); onChanged(); toast.success('Bank updated');
    } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!window.confirm(`Approve ${run.period} payroll? This will generate a signed Board Resolution PDF.`)) return;
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${runId}/approve`);
      toast.success('Approved · Board Resolution generated');
      await load(); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Approve failed'); }
    finally { setBusy(false); }
  };
  const markPaid = async () => {
    if (!window.confirm('Mark this run as PAID? This creates Expense rows in P&L and generates salary slips. This action is irreversible.')) return;
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${runId}/mark-paid`, paidForm);
      toast.success('Run marked PAID · slips & expenses created');
      await load(); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Mark-paid failed'); }
    finally { setBusy(false); }
  };
  const updateItem = async (id, patch) => {
    try {
      await api.patch(`/payroll/items/${id}`, patch);
      await load(); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Update failed'); }
  };
  const uploadProof = async (itemId, file) => {
    const fd = new FormData(); fd.append('file', file);
    try {
      await api.post(`/payroll/items/${itemId}/transfer-proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Transfer proof uploaded');
      await load();
    } catch (err) { toast.error('Upload failed: ' + (err.response?.data?.message || err.message)); }
  };

  return (
    <Modal open onClose={onClose} title={`Payroll · ${periodLabel(run.period)}`} testId={`run-detail-${run.period}`} size="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <KPI label="Status"><Badge className={meta.cls}>{meta.label}</Badge></KPI>
          <KPI label="Total Net (AED)">AED {fmtAed(run.total_net_aed)}</KPI>
          <KPI label="Pay Date">{fmtDate(run.paid_at)}</KPI>
          <KPI label="Items">{run.items?.length || 0}</KPI>
        </div>

        <div className="card-axistra p-4 grid md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="label-xs mb-1 block">Paid From</label>
            <select
              value={run.paid_from_bank_id || ''}
              onChange={(e) => updateBank(e.target.value)}
              disabled={!editable || busy}
              className="input-axistra"
              data-testid="run-detail-bank-select"
            >
              <option value="">— none selected —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
            </select>
          </div>
          {isApproved && (
            <>
              <div>
                <label className="label-xs mb-1 block">Pay Date (override)</label>
                <input
                  type="date" value={paidForm.paid_at}
                  onChange={(e) => setPaidForm({ ...paidForm, paid_at: e.target.value })}
                  className="input-axistra"
                  data-testid="run-mark-paid-date"
                />
              </div>
              <div className="md:col-span-2">
                <label className="label-xs mb-1 block">Transfer Reference (Wio wire ref)</label>
                <input
                  type="text" value={paidForm.transfer_reference}
                  onChange={(e) => setPaidForm({ ...paidForm, transfer_reference: e.target.value })}
                  placeholder="e.g. Salary May 2026"
                  className="input-axistra font-mono"
                  data-testid="run-mark-paid-ref"
                />
              </div>
            </>
          )}
        </div>

        <div className="card-axistra overflow-x-auto">
          <table className="table-axistra">
            <thead><tr>
              <th>Employee</th><th>Position</th>
              <th className="text-right">Basic</th><th className="text-right">+Allowance</th>
              <th className="text-right">−Deduction</th><th className="text-right">Net (AED)</th>
              <th>Documents</th>
            </tr></thead>
            <tbody>
              {run.items?.map((i) => (
                <tr key={i.id} data-testid={`run-item-${i.employee_name.replace(/\s+/g,'_')}`}>
                  <td className="font-medium">{i.employee_name}</td>
                  <td className="text-xs text-gray-500">{i.position}</td>
                  <td className="text-right font-mono">{fmtAed(i.basic_salary)}</td>
                  <td className="text-right">
                    <NumCell
                      value={i.allowances}
                      disabled={!editable}
                      onChange={(v) => updateItem(i.id, { allowances: v })}
                    />
                  </td>
                  <td className="text-right">
                    <NumCell
                      value={i.deductions}
                      disabled={!editable}
                      onChange={(v) => updateItem(i.id, { deductions: v })}
                    />
                  </td>
                  <td className="text-right font-mono font-semibold">{fmtAed(i.net_salary_aed)}</td>
                  <td className="text-xs">
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        onClick={() => openBlobInNewTab(`${API_BASE}/payroll/items/${i.id}/salary-slip.pdf`)}
                        className="text-axistra-green hover:underline inline-flex items-center gap-1"
                        data-testid={`slip-${i.employee_name.replace(/\s+/g,'_')}`}
                        title="View salary slip"
                      ><FileText size={13}/> Slip</button>
                      <label className="text-axistra-green hover:underline inline-flex items-center gap-1 cursor-pointer">
                        <UploadSimple size={13}/> {i.transfer_proof_path ? 'Replace proof' : 'Upload proof'}
                        <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(i.id, e.target.files[0])} accept=".pdf,image/*" data-testid={`proof-upload-${i.employee_name.replace(/\s+/g,'_')}`} />
                      </label>
                      {i.transfer_proof_path && (
                        <button
                          onClick={() => openBlobInNewTab(`${API_BASE}/payroll/items/${i.id}/transfer-proof`)}
                          className="text-gray-500 hover:underline inline-flex items-center gap-1"
                          title="View uploaded proof"
                        ><ArrowSquareOut size={12}/> view</button>
                      )}
                      {i.expense_id && <span className="hash-pill text-[10px]" title="Linked Expense row in P&L"><Receipt size={11} className="inline mr-1"/>P&amp;L</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          {run.board_resolution_path && (
            <button
              onClick={() => openBlobInNewTab(`${API_BASE}/payroll/runs/${runId}/board-resolution.pdf`)}
              className="btn-secondary inline-flex items-center gap-2"
              data-testid="run-board-resolution-btn"
            ><FileText size={14}/> Board Resolution</button>
          )}
          {isDraft && (
            <button onClick={approve} disabled={busy} className="btn-primary inline-flex items-center gap-2" data-testid="run-approve-btn">
              <CheckCircle size={14}/> Approve & generate resolution
            </button>
          )}
          {isApproved && (
            <button onClick={markPaid} disabled={busy} className="btn-primary inline-flex items-center gap-2 bg-amber-700 hover:bg-amber-800" data-testid="run-mark-paid-btn">
              <CurrencyCircleDollar size={14}/> Mark Paid (creates P&amp;L expenses)
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

const KPI = ({ label, children }) => (
  <div className="card-axistra p-3">
    <div className="label-xs">{label}</div>
    <div className="text-base font-semibold mt-1">{children}</div>
  </div>
);

function NumCell({ value, onChange, disabled }) {
  const [v, setV] = useState(String(value || '0'));
  useEffect(() => { setV(String(value || '0')); }, [value]);
  return (
    <input
      type="number" step="0.01" min="0" disabled={disabled}
      value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== String(value || '0')) onChange(v || '0'); }}
      className="input-axistra py-1 w-24 text-right font-mono text-sm"
    />
  );
}

// ===================================================================
// Tab: Employees
// ===================================================================
function EmployeesTab({ items, onChanged }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const empty = { full_name: '', position: '', monthly_salary: '', salary_currency: 'AED', start_date: '', email: '', phone: '', bank_name: '', bank_iban: '', notes: '', status: 'active' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const openCreate = () => { setEdit(null); setForm(empty); setOpen(true); };
  const openEdit = (e) => { setEdit(e); setForm({ ...empty, ...e, start_date: e.start_date?.slice(0, 10) || '' }); setOpen(true); };
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    try {
      if (edit) {
        // Strip salary/position from the generic update payload — they MUST
        // go through "Change Salary" / "Change Position" actions in history.
        // eslint-disable-next-line no-unused-vars
        const { monthly_salary, position, ...safe } = form;
        await api.patch(`/payroll/employees/${edit.id}`, safe);
      } else {
        await api.post('/payroll/employees', form);
      }
      toast.success(edit ? 'Employee info updated' : 'Employee added');
      setOpen(false); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setBusy(false); }
  };
  const del = async (e) => {
    if (!window.confirm(`Delete ${e.full_name}? (Only allowed if they have no payroll history.)`)) return;
    try {
      await api.delete(`/payroll/employees/${e.id}`);
      toast.success('Employee deleted'); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-gray-500">{items.length} employees · {items.filter((e)=>e.status==='active').length} active</div>
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" data-testid="payroll-add-employee-btn">
          <Plus size={15} /> Add Employee
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No employees yet" hint="Add Hemant and Sanjana to start your May 2026 payroll." />
      ) : (
        <div className="card-axistra overflow-x-auto">
          <table className="table-axistra">
            <thead><tr><th>Code</th><th>Name</th><th>Position</th><th className="text-right">Salary</th><th>Start</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} data-testid={`employee-row-${e.full_name.replace(/\s+/g,'_')}`}>
                  <td className="font-mono text-xs">{e.employee_code}</td>
                  <td className="font-medium">{e.full_name}<div className="text-xs text-gray-400">{e.email || '—'}</div></td>
                  <td>{e.position}</td>
                  <td className="text-right font-mono">{e.salary_currency} {fmtAed(e.monthly_salary)}</td>
                  <td>{fmtDate(e.start_date)}</td>
                  <td><Badge className={e.status === 'active' ? 'badge-success' : 'badge-neutral'}>{e.status}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => openBlobInNewTab(`${API_BASE}/payroll/employees/${e.id}/offer-letter.pdf`)} className="text-axistra-green p-1" title="Offer letter PDF" data-testid={`offer-letter-${e.full_name.replace(/\s+/g,'_')}`}><FileText size={14}/></button>
                    <button onClick={() => openEdit(e)} className="text-gray-500 hover:text-axistra-green p-1" title="Edit" data-testid={`employee-edit-${e.full_name.replace(/\s+/g,'_')}`}><Pencil size={14}/></button>
                    <button onClick={() => del(e)} className="text-gray-500 hover:text-red-600 p-1" title="Delete" data-testid={`employee-delete-${e.full_name.replace(/\s+/g,'_')}`}><Trash size={14}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={edit ? `Edit Employee — ${edit.full_name}` : 'Add Employee'} size="lg" testId="employee-modal">
        {edit ? (
          <EditEmployeeBody employee={edit} form={form} setForm={setForm} save={save} busy={busy} onClose={() => setOpen(false)} onChanged={onChanged} />
        ) : (
          <EmployeeForm form={form} setForm={setForm} save={save} busy={busy} onClose={() => setOpen(false)} edit={false} />
        )}
      </Modal>
    </div>
  );
}

/** Read-only form fields for ADD mode + EDIT info tab. */
function EmployeeForm({ form, setForm, save, busy, onClose, edit }) {
  return (
    <form onSubmit={save} className="grid md:grid-cols-2 gap-3">
      <Field label="Full Name"><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-axistra" data-testid="employee-name-input"/></Field>
      <Field label="Position">
        <input
          required
          value={form.position}
          onChange={(e) => setForm({ ...form, position: e.target.value })}
          className={`input-axistra ${edit ? 'bg-gray-50 cursor-not-allowed' : ''}`}
          readOnly={edit}
          data-testid="employee-position-input"
          title={edit ? 'Use the "Change Position" action to update' : ''}
        />
        {edit && <div className="text-[10px] text-gray-500 mt-1">🔒 Use "Change Position" in the Employment History tab to update.</div>}
      </Field>
      <Field label="Monthly Salary">
        <input
          type="number" step="0.01" required
          value={form.monthly_salary}
          onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
          className={`input-axistra ${edit ? 'bg-gray-50 cursor-not-allowed' : ''}`}
          readOnly={edit}
          data-testid="employee-salary-input"
          title={edit ? 'Use the "Change Salary" action to update' : ''}
        />
        {edit && <div className="text-[10px] text-gray-500 mt-1">🔒 Use "Change Salary" in the Employment History tab to update.</div>}
      </Field>
      <Field label="Currency">
        <select value={form.salary_currency} onChange={(e) => setForm({ ...form, salary_currency: e.target.value })} className="input-axistra" data-testid="employee-currency-select">
          <option>AED</option><option>USD</option><option>EUR</option><option>INR</option>
        </select>
      </Field>
      <Field label="Start Date"><input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="input-axistra"/></Field>
      <Field label="Status">
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-axistra">
          <option value="active">Active</option><option value="on_leave">On Leave</option><option value="terminated">Terminated</option>
        </select>
      </Field>
      <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-axistra"/></Field>
      <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-axistra"/></Field>
      <Field label="Bank Name"><input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="input-axistra"/></Field>
      <Field label="IBAN"><input value={form.bank_iban} onChange={(e) => setForm({ ...form, bank_iban: e.target.value })} className="input-axistra font-mono"/></Field>
      <div className="md:col-span-2">
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-axistra"/></Field>
      </div>
      <div className="md:col-span-2 flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={busy} className="btn-primary" data-testid="employee-save-btn">{busy ? 'Saving…' : (edit ? 'Save Info' : 'Add Employee')}</button>
      </div>
    </form>
  );
}

/** Edit modal body with two tabs: Info (regular fields) | Employment History (salary/position changes + timeline). */
function EditEmployeeBody({ employee, form, setForm, save, busy, onClose, onChanged }) {
  const [tab, setTab] = useState('info');
  return (
    <div>
      <div className="flex border-b border-gray-200 mb-4 gap-1">
        <TabBtn active={tab === 'info'} onClick={() => setTab('info')} testId="employee-tab-info">Personal Info</TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')} testId="employee-tab-history">Employment History &amp; Changes</TabBtn>
      </div>
      {tab === 'info' && <EmployeeForm form={form} setForm={setForm} save={save} busy={busy} onClose={onClose} edit={true} />}
      {tab === 'history' && (
        <EmploymentHistory
          employee={employee}
          apiBase={API_BASE}
          onSalaryOrPositionChanged={() => onChanged?.()}
        />
      )}
    </div>
  );
}

const TabBtn = ({ active, onClick, testId, children }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`px-3 py-2 text-sm font-medium border-b-2 transition ${
      active ? 'border-axistra-green text-axistra-green' : 'border-transparent text-gray-500 hover:text-gray-800'
    }`}
  >{children}</button>
);

// ===================================================================
// Tab: Bank Accounts
// ===================================================================
function BanksTab({ items, onChanged }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const empty = { name: '', bank_name: '', currency: 'AED', account_number: '', iban: '', swift: '', branch: '', is_default_payroll: false, is_active: true, notes: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const openCreate = () => { setEdit(null); setForm(empty); setOpen(true); };
  const openEdit = (b) => { setEdit(b); setForm({ ...empty, ...b }); setOpen(true); };
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    try {
      if (edit) await api.patch(`/payroll/bank-accounts/${edit.id}`, form);
      else await api.post('/payroll/bank-accounts', form);
      toast.success(edit ? 'Bank updated' : 'Bank added');
      setOpen(false); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setBusy(false); }
  };
  const del = async (b) => {
    if (!window.confirm(`Delete bank account "${b.name}"?`)) return;
    try {
      await api.delete(`/payroll/bank-accounts/${b.id}`);
      toast.success('Bank deleted'); onChanged();
    } catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-gray-500">{items.length} bank account(s)</div>
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" data-testid="payroll-add-bank-btn">
          <Plus size={15} /> Add Bank Account
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No bank accounts yet" hint="Add Wio Business AED to use it as the default payroll bank." />
      ) : (
        <div className="card-axistra overflow-x-auto">
          <table className="table-axistra">
            <thead><tr><th>Name</th><th>Bank</th><th>Currency</th><th>IBAN</th><th>Default Payroll</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} data-testid={`bank-row-${b.name.replace(/\W+/g,'_')}`}>
                  <td className="font-medium">{b.name}</td>
                  <td>{b.bank_name || '—'}</td>
                  <td className="font-mono">{b.currency}</td>
                  <td className="font-mono text-xs">{b.iban || '—'}</td>
                  <td>{b.is_default_payroll && <Badge className="badge-success">Default</Badge>}</td>
                  <td><Badge className={b.is_active ? 'badge-success' : 'badge-neutral'}>{b.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="text-right">
                    <button onClick={() => openEdit(b)} className="text-gray-500 hover:text-axistra-green p-1"><Pencil size={14}/></button>
                    <button onClick={() => del(b)} className="text-gray-500 hover:text-red-600 p-1"><Trash size={14}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={edit ? 'Edit Bank Account' : 'Add Bank Account'} size="lg" testId="bank-modal">
        <form onSubmit={save} className="grid md:grid-cols-2 gap-3">
          <Field label="Display Name"><input required placeholder="Wio Business — AED" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-axistra" data-testid="bank-name-input"/></Field>
          <Field label="Bank"><input placeholder="Wio Bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="input-axistra"/></Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="input-axistra">
              <option>AED</option><option>USD</option><option>EUR</option><option>INR</option><option>GBP</option>
            </select>
          </Field>
          <Field label="Account Number"><input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} className="input-axistra font-mono"/></Field>
          <Field label="IBAN"><input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} className="input-axistra font-mono"/></Field>
          <Field label="SWIFT / BIC"><input value={form.swift} onChange={(e) => setForm({ ...form, swift: e.target.value })} className="input-axistra font-mono"/></Field>
          <Field label="Branch"><input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="input-axistra"/></Field>
          <div className="flex items-center gap-3 mt-7">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.is_default_payroll} onChange={(e) => setForm({ ...form, is_default_payroll: e.target.checked })} /> Default for payroll</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
          </div>
          <div className="md:col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary" data-testid="bank-save-btn">{busy ? 'Saving…' : (edit ? 'Save' : 'Add Bank')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
