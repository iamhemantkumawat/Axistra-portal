import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, XCircle, ShieldCheck, Warning, FileText } from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_BASE = import.meta.env?.VITE_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '';
const LOGO_URL = '/axistra-landscape-logo-2026.png';

const fmtAed = (n, cur = 'AED') => `${cur} ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

/**
 * Public counter-signing page. Reached via /sign/<token> — token-only auth.
 * Renders a clean letter preview + signature + Agree/Decline buttons. Posts
 * back to /api/sign-letter/<token> which closes the loop server-side.
 */
export default function SignLetter() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState('');
  const [showDeclineNote, setShowDeclineNote] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  const [done, setDone] = useState(null); // { status, signed_at }

  useEffect(() => {
    fetch(`${API_BASE}/api/sign-letter/${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(j)))
      .then((d) => { setDoc(d); setSignature(d.employee_name); })
      .catch((e) => setError(e.message || 'Invalid link'));
  }, [token]);

  const submit = async (decision) => {
    if (decision === 'agreed' && !signature.trim()) {
      toast.error('Please type your full name to sign');
      return;
    }
    if (decision === 'declined' && !showDeclineNote) {
      setShowDeclineNote(true);
      return;
    }
    setBusy(true);
    try {
      const body = decision === 'agreed'
        ? { decision, signature, signature_method: 'typed' }
        : { decision, decline_note: declineNote || 'Declined without note' };
      const res = await fetch(`${API_BASE}/api/sign-letter/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      setDone({ status: data.status, signed_at: data.signed_at });
    } catch (err) {
      toast.error(err.message || 'Submission failed');
    } finally { setBusy(false); }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-md max-w-md p-8 text-center">
          <Warning size={48} weight="duotone" className="text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-display font-semibold">Link not valid</h1>
          <p className="text-gray-600 mt-2">{error}</p>
          <p className="text-xs text-gray-500 mt-4">If you received this link from Axistra Technologies, please ask the sender to share a fresh link.</p>
        </div>
      </div>
    );
  }
  if (!doc) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading letter…</div>;
  }

  if (done) {
    const positive = done.status === 'agreed';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-md max-w-md p-8 text-center" data-testid="sign-done">
          {positive
            ? <CheckCircle size={56} weight="duotone" className="text-emerald-500 mx-auto mb-3" />
            : <XCircle size={56} weight="duotone" className="text-red-500 mx-auto mb-3" />}
          <h1 className="text-2xl font-display font-semibold">
            {positive ? 'Thank you — your signature is recorded' : 'Decision recorded'}
          </h1>
          <p className="text-gray-600 mt-2">
            {positive
              ? `You have accepted ${doc.reference_number} on ${fmtDate(done.signed_at)}. A countersigned PDF has been saved to your company's compliance vault.`
              : `Your decision has been logged. Axistra Technologies has been notified and will be in touch.`}
          </p>
          <p className="text-xs text-gray-500 mt-6">You may now close this page.</p>
        </div>
      </div>
    );
  }

  const alreadySigned = doc.sign_status === 'agreed' || doc.sign_status === 'declined';

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden" data-testid="sign-letter-page">
          {/* Letterhead */}
          <div className="bg-[#0E6B45] text-white px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={LOGO_URL} alt="Axistra" className="h-10 bg-white rounded px-2 py-1" />
              <div>
                <div className="font-display font-bold tracking-wider">AXISTRA TECHNOLOGIES</div>
                <div className="text-[10px] uppercase tracking-[0.2em] opacity-80">— FZCO ·  Compliance Portal</div>
              </div>
            </div>
            <div className="text-right text-xs opacity-90">
              <div className="font-mono">{doc.reference_number}</div>
              <div className="uppercase tracking-wider mt-1">{doc.change_type.replace(/_/g, ' ')}</div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-6 space-y-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-500">
              <ShieldCheck size={14} weight="duotone" className="text-axistra-green" />
              Counter-Signing Required
            </div>
            <h1 className="font-display text-2xl font-bold text-gray-900">
              {doc.change_type === 'salary_change' ? 'Salary Revision Letter'
                : doc.change_type === 'position_change' ? 'Position Change Letter'
                : 'Employment Letter'}
            </h1>
            <p className="text-gray-700">
              Dear <strong>{doc.employee_name.split(' ')[0]}</strong>,
            </p>
            <p className="text-gray-700">
              Pursuant to the Board Resolution of <strong>{doc.employer}</strong>, please review the change to your employment
              terms detailed below. To confirm acceptance, type your name in the signature box and click <strong>I Agree</strong>.
            </p>

            {/* Comparison */}
            {doc.change_type === 'salary_change' && (
              <div className="grid grid-cols-3 gap-3 my-2">
                <Box label="Previous Salary" value={fmtAed(doc.old_salary, doc.salary_currency)} muted />
                <Box label="Revised Salary" value={fmtAed(doc.new_salary, doc.salary_currency)} highlight />
                <Box label="Effective" value={fmtDate(doc.effective_date)} />
              </div>
            )}
            {doc.change_type === 'position_change' && (
              <div className="grid grid-cols-3 gap-3 my-2">
                <Box label="Previous Position" value={doc.old_position || '—'} muted />
                <Box label="New Position" value={doc.new_position || '—'} highlight />
                <Box label="Effective" value={fmtDate(doc.effective_date)} />
              </div>
            )}

            {doc.reason && (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700">
                <span className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Reason</span>
                <div className="mt-1">{doc.reason}</div>
              </div>
            )}

            <p className="text-gray-700 text-sm">
              All other terms of your employment remain unchanged. The revised terms shall supersede any prior conflicting terms
              from <strong>{fmtDate(doc.effective_date)}</strong>.
            </p>

            <div className="border-t border-gray-200 pt-5">
              <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">
                For and on behalf of {doc.employer}
              </div>
              <div className="font-display font-bold text-axistra-green text-lg">{doc.director_name}</div>
              <div className="text-xs text-gray-500">Director</div>
            </div>
          </div>

          {/* Sign zone */}
          {alreadySigned ? (
            <div className="bg-gray-50 border-t border-gray-200 px-8 py-6 text-center">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                doc.sign_status === 'agreed' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {doc.sign_status === 'agreed' ? <CheckCircle size={16} weight="duotone" /> : <XCircle size={16} weight="duotone" />}
                Already {doc.sign_status} on {fmtDate(doc.signed_at)}
              </div>
              <p className="text-xs text-gray-500 mt-3">This letter has already been counter-signed. Contact Axistra if you need a copy.</p>
            </div>
          ) : (
            <div className="bg-gray-50 border-t border-gray-200 px-8 py-6 space-y-4">
              {!showDeclineNote && (
                <>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold block mb-2">
                      Type your full name to sign
                    </label>
                    <input
                      value={signature}
                      onChange={(e) => setSignature(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-4 py-3 text-2xl font-bold text-axistra-green"
                      style={{ fontFamily: "'Brush Script MT','Pinyon Script', cursive" }}
                      data-testid="sign-signature-input"
                      placeholder={doc.employee_name}
                    />
                    <div className="text-[10px] text-gray-500 mt-1">
                      Typing your name is treated as your electronic signature, equivalent to a handwritten signature under UAE Federal Decree-Law No. 46 of 2021.
                    </div>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => submit('declined')}
                      disabled={busy}
                      className="px-5 py-2.5 rounded-md text-sm border border-red-300 text-red-700 hover:bg-red-50 inline-flex items-center gap-2"
                      data-testid="sign-decline-btn"
                    ><XCircle size={16} /> Decline</button>
                    <button
                      onClick={() => submit('agreed')}
                      disabled={busy || !signature.trim()}
                      className="px-5 py-2.5 rounded-md text-sm bg-axistra-green text-white hover:bg-[var(--axistra-green-dark)] inline-flex items-center gap-2 disabled:opacity-50"
                      data-testid="sign-agree-btn"
                    ><CheckCircle size={16} weight="duotone" /> {busy ? 'Submitting…' : 'I Agree'}</button>
                  </div>
                </>
              )}
              {showDeclineNote && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold block mb-2">
                      Reason for declining (optional but recommended)
                    </label>
                    <textarea
                      rows={3}
                      value={declineNote}
                      onChange={(e) => setDeclineNote(e.target.value)}
                      placeholder="e.g. I would like to discuss the proposed terms before accepting."
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      data-testid="sign-decline-note"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setShowDeclineNote(false); setDeclineNote(''); }}
                      className="px-4 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
                    >Back</button>
                    <button
                      onClick={() => submit('declined')}
                      disabled={busy}
                      className="px-5 py-2.5 rounded-md text-sm bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-2"
                      data-testid="sign-decline-confirm-btn"
                    >{busy ? 'Submitting…' : 'Confirm Decline'}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-200 px-8 py-3 text-[10px] text-gray-500 flex justify-between">
            <span>Axistra Compliance Portal · Token-protected single-use link</span>
            <span className="font-mono">{doc.reference_number}</span>
          </div>
        </div>

        <div className="text-center text-xs text-gray-500 mt-6 inline-flex items-center gap-1 w-full justify-center">
          <FileText size={12} /> A countersigned PDF will be saved automatically once you submit.
        </div>
      </div>
    </div>
  );
}

const Box = ({ label, value, highlight, muted }) => (
  <div className={`rounded-md border px-4 py-3 ${
    highlight ? 'border-axistra-green bg-[var(--axistra-green-light)]' :
    muted ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-200 bg-white'
  }`}>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{label}</div>
    <div className={`mt-1 font-bold text-base ${highlight ? 'text-axistra-green' : ''}`}>{value}</div>
  </div>
);
