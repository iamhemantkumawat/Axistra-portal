import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { API_BASE } from '../lib/api';
import { PageHeader, Badge } from '../components/Atoms';
import { toast } from 'sonner';
import {
  ArrowLeft, CalendarBlank, Briefcase, CurrencyDollar, TrendUp, TrendDown,
  FileText, CheckCircle, XCircle, Clock, Hourglass, Pencil, Envelope, Phone, MapPin, IdentificationCard, Buildings,
} from '@phosphor-icons/react';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtMoney = (n, c = 'AED') => `${c} ${(Number(n) || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CHANGE_META = {
  initial_offer: { label: 'Initial Offer', icon: FileText, color: 'bg-blue-100 text-blue-700 border-blue-200' },
  salary_change: { label: 'Salary Revision', icon: CurrencyDollar, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  position_change: { label: 'Position Change', icon: Briefcase, color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

const SIGN_META = {
  pending: { label: 'Awaiting signature', cls: 'badge-warning', icon: Hourglass },
  agreed: { label: 'Signed', cls: 'badge-success', icon: CheckCircle },
  declined: { label: 'Declined', cls: 'badge-error', icon: XCircle },
};

function openBlobInNewTab(url) {
  const token = localStorage.getItem('axistra_token');
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.blob())
    .then((blob) => window.open(URL.createObjectURL(blob), '_blank'));
}

function pctChange(oldVal, newVal) {
  const a = Number(oldVal) || 0;
  const b = Number(newVal) || 0;
  if (!a) return null;
  return ((b - a) / a) * 100;
}

function copySignLink(token) {
  if (!token) { toast.error('No sign token available'); return; }
  const url = `${window.location.origin}/sign/${token}`;
  navigator.clipboard.writeText(url).then(
    () => toast.success('Sign link copied'),
    () => toast.error('Copy failed'),
  );
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [emp, hist] = await Promise.all([
        api.get(`/payroll/employees/${id}`),
        api.get(`/payroll/employees/${id}/history`),
      ]);
      setEmployee(emp.data);
      setHistory(hist.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load employee');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (loading) return <div className="text-gray-500 p-6">Loading employee…</div>;
  if (!employee) return <div className="p-6">Employee not found. <Link to="/payroll" className="text-axistra-green hover:underline">Back to Payroll</Link></div>;

  const sorted = [...history].sort((a, b) => new Date(b.effective_date || b.created_at) - new Date(a.effective_date || a.created_at));
  const revisions = sorted.filter((c) => c.change_type === 'salary_change');
  const positionChanges = sorted.filter((c) => c.change_type === 'position_change');
  const initialOffer = sorted.find((c) => c.change_type === 'initial_offer');

  const tenureMonths = (() => {
    if (!employee.start_date) return null;
    const start = new Date(employee.start_date);
    const now = new Date();
    return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  })();

  return (
    <div data-testid="employee-detail-page">
      <Link to="/payroll" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-axistra-green mb-3" data-testid="emp-back-btn">
        <ArrowLeft size={14} /> Back to Payroll
      </Link>
      <PageHeader
        eyebrow={employee.employee_code}
        title={employee.full_name}
        subtitle={`${employee.position} · ${employee.employer || 'Axistra Technologies — FZCO'}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openBlobInNewTab(`${API_BASE}/payroll/employees/${id}/offer-letter.pdf`)} className="btn-secondary inline-flex items-center gap-1.5" data-testid="emp-letter-btn">
              <FileText size={16} weight="duotone" /> Latest Letter
            </button>
          </div>
        )}
      />

      {/* Profile + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="card-axistra p-5 lg:col-span-1" data-testid="emp-profile-card">
          <div className="label-xs mb-3">Profile</div>
          <div className="space-y-2.5 text-sm">
            <ProfileRow icon={Envelope} label="Email" value={employee.email} />
            <ProfileRow icon={Phone} label="Phone" value={employee.phone} />
            <ProfileRow icon={MapPin} label="Address" value={employee.address} />
            <ProfileRow icon={IdentificationCard} label="ID / Passport" value={employee.id_number} />
            <ProfileRow icon={Buildings} label="Department" value={employee.department} />
            <ProfileRow icon={CalendarBlank} label="Start Date" value={fmtDate(employee.start_date)} />
            <ProfileRow icon={Badge} label="Status" valueNode={<Badge className={employee.status === 'active' ? 'badge-success' : 'badge-neutral'}>{employee.status}</Badge>} />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:col-span-2 gap-4">
          <Kpi label="Current Monthly Salary" value={fmtMoney(employee.monthly_salary, employee.salary_currency)} icon={CurrencyDollar} accent testId="emp-kpi-salary" />
          <Kpi label="Salary Revisions" value={revisions.length} icon={TrendUp} sub={revisions.length > 0 ? `Latest ${fmtDate(revisions[0].effective_date)}` : 'No revisions yet'} testId="emp-kpi-revisions" />
          <Kpi label="Position Changes" value={positionChanges.length} icon={Briefcase} testId="emp-kpi-positions" />
          <Kpi label="Tenure" value={tenureMonths !== null ? `${tenureMonths} mo` : '—'} icon={CalendarBlank} sub={initialOffer ? `Joined ${fmtDate(initialOffer.effective_date)}` : ''} testId="emp-kpi-tenure" />
        </div>
      </div>

      {/* Timeline */}
      <div className="card-axistra p-6" data-testid="emp-timeline-card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="label-xs">HR audit trail</div>
            <h3 className="font-display text-xl font-semibold">Employment History</h3>
            <p className="text-xs text-gray-500 mt-1">Chronological record of offer, salary revisions and position changes. Each event has a signed PDF letter and (where applicable) an employee back-sign stamp.</p>
          </div>
          <div className="text-sm text-gray-500">{sorted.length} event{sorted.length === 1 ? '' : 's'}</div>
        </div>

        {sorted.length === 0 && <div className="text-center text-gray-500 py-10">No employment events recorded yet.</div>}

        <ol className="relative space-y-6 border-l-2 border-gray-200 ml-4">
          {sorted.map((c, idx) => {
            const meta = CHANGE_META[c.change_type] || CHANGE_META.initial_offer;
            const sign = SIGN_META[c.sign_status] || SIGN_META.pending;
            const Icon = meta.icon;
            const SignIcon = sign.icon;
            const change = c.change_type === 'salary_change' ? pctChange(c.old_salary, c.new_salary) : null;
            return (
              <li key={c.id} className="ml-6 pl-2" data-testid={`emp-timeline-event-${idx}`}>
                <div className={`absolute -left-3 mt-0.5 w-5 h-5 rounded-full border-2 ${meta.color} flex items-center justify-center`}>
                  <Icon size={10} weight="bold" />
                </div>

                <div className="border border-gray-200 rounded-lg p-4 hover:border-axistra-green/40 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900">{meta.label}</span>
                        {c.reference_number && <span className="font-mono text-[11px] text-gray-500">{c.reference_number}</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Effective {fmtDate(c.effective_date)} · Recorded {fmtDate(c.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.change_type !== 'initial_offer' && (
                        <Badge className={sign.cls}><SignIcon size={11} className="inline mr-1" />{sign.label}</Badge>
                      )}
                    </div>
                  </div>

                  {/* Change details */}
                  {c.change_type === 'salary_change' && (
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                      <div className="text-sm">
                        <span className="text-gray-500">Salary:</span>
                        <span className="font-mono ml-2 line-through text-gray-400">{fmtMoney(c.old_salary, c.salary_currency)}</span>
                        <span className="font-mono ml-2 text-axistra-green font-semibold">{fmtMoney(c.new_salary, c.salary_currency)}</span>
                      </div>
                      {change !== null && (
                        <Badge className={change >= 0 ? 'badge-success' : 'badge-error'}>
                          {change >= 0 ? <TrendUp size={11} className="inline mr-1" /> : <TrendDown size={11} className="inline mr-1" />}
                          {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                        </Badge>
                      )}
                    </div>
                  )}

                  {c.change_type === 'position_change' && (
                    <div className="mt-3 text-sm">
                      <span className="text-gray-500">Position:</span>
                      <span className="ml-2 line-through text-gray-400">{c.old_position}</span>
                      <span className="ml-2 text-axistra-green font-semibold">{c.new_position}</span>
                    </div>
                  )}

                  {c.change_type === 'initial_offer' && (
                    <div className="mt-3 text-sm space-y-1">
                      <div><span className="text-gray-500">Position:</span> <span className="font-medium">{c.new_position || employee.position}</span></div>
                      <div><span className="text-gray-500">Salary:</span> <span className="font-mono text-axistra-green font-semibold">{fmtMoney(c.new_salary || employee.monthly_salary, c.salary_currency || employee.salary_currency)}</span></div>
                    </div>
                  )}

                  {c.reason && (
                    <div className="mt-3 text-xs text-gray-600 italic border-l-2 border-gray-200 pl-3">"{c.reason}"</div>
                  )}

                  {c.signed_at && (
                    <div className="mt-3 text-[11px] text-gray-500 flex items-center gap-2">
                      <Clock size={11} /> Signed {fmtDate(c.signed_at)}
                      {c.sign_ip && <span className="font-mono">· IP {c.sign_ip}</span>}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => openBlobInNewTab(`${API_BASE}/payroll/changes/${c.id}/letter.pdf`)}
                      className="text-xs text-axistra-green hover:underline inline-flex items-center gap-1"
                      data-testid={`emp-event-pdf-${idx}`}
                    >
                      <FileText size={12} /> View Letter PDF
                    </button>
                    {c.has_sign_token && c.change_type !== 'initial_offer' && c.sign_status !== 'agreed' && (
                      <button
                        onClick={() => copySignLink(c.sign_token)}
                        className="text-xs text-gray-500 hover:text-axistra-green inline-flex items-center gap-1"
                        data-testid={`emp-event-signlink-${idx}`}
                      >
                        <Pencil size={12} /> Copy Sign Link
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function ProfileRow({ icon: Icon, label, value, valueNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} weight="duotone" className="text-axistra-green mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
        {valueNode || <div className="text-sm text-gray-800 truncate">{value || '—'}</div>}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, accent, testId }) {
  return (
    <div className={`card-axistra p-4 ${accent ? 'bg-gradient-to-br from-[var(--axistra-green-light)] to-white border-axistra-green/20' : ''}`} data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
        {Icon && <Icon size={14} weight="duotone" className={accent ? 'text-axistra-green' : 'text-gray-400'} />}
        <span>{label}</span>
      </div>
      <div className={`font-display font-bold text-2xl ${accent ? 'text-axistra-green' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
