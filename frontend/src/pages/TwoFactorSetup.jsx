import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import { ShieldCheck, Copy, Key, Check, Warning } from '@phosphor-icons/react';

export default function TwoFactorSetup() {
  const { user, refreshUser } = useAuth();
  const nav = useNavigate();
  const [setupData, setSetupData] = useState(null); // {otpauth_url, qr_data_url, secret}
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const startSetup = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/2fa/setup');
      setSetupData(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start 2FA setup');
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/2fa/enable', { code });
      setRecoveryCodes(data.recovery_codes);
      await refreshUser();
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code — try again');
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const finishSetup = () => nav('/dashboard');

  // Stage 3: show recovery codes after enable
  if (recoveryCodes) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="two-fa-recovery-screen">
        <div className="card-axistra p-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-[var(--axistra-green-light)] flex items-center justify-center">
              <Check size={22} weight="bold" className="text-axistra-green" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-axistra-green font-semibold">Step 3 of 3</div>
              <h1 className="font-display text-2xl font-bold">Save your recovery codes</h1>
            </div>
          </div>

          <div className="rounded-md border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 mb-5 flex gap-2">
            <Warning size={20} weight="duotone" className="flex-shrink-0 mt-0.5" />
            <div>
              Store these <strong>now</strong> in a password manager. Each code can be used <strong>once</strong> if you lose access to your authenticator app. We do not store them in a recoverable form — once you leave this screen, they are gone.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {recoveryCodes.map((c) => (
              <div key={c} className="bg-gray-50 border border-gray-200 rounded px-4 py-3 font-mono text-sm flex items-center justify-between">
                <span data-testid={`recovery-code-${c}`}>{c}</span>
                <button onClick={() => copy(c)} className="text-gray-400 hover:text-axistra-green" title="Copy"><Copy size={14} /></button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => copy(recoveryCodes.join('\n'))}
              className="btn-secondary inline-flex items-center gap-2"
              data-testid="copy-all-recovery-codes-btn"
            ><Copy size={14} /> Copy all</button>
            <button
              onClick={finishSetup}
              className="btn-primary"
              data-testid="finish-two-fa-setup-btn"
            >I have saved them — Continue</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="two-fa-setup-page">
      <div className="card-axistra p-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-[var(--axistra-green-light)] flex items-center justify-center">
            <ShieldCheck size={22} weight="duotone" className="text-axistra-green" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-axistra-green font-semibold">
              {setupData ? 'Step 2 of 3' : 'Step 1 of 3'}
            </div>
            <h1 className="font-display text-2xl font-bold">
              {setupData ? 'Scan & verify' : 'Set up Two-Factor Authentication'}
            </h1>
          </div>
        </div>

        {!setupData && (
          <>
            <p className="text-gray-600 mb-2">
              Hi <strong>{user?.full_name}</strong> — admin accounts must enable 2FA to access the portal. You'll need an authenticator app such as <strong>Google Authenticator</strong>, <strong>Authy</strong>, or <strong>1Password</strong>.
            </p>
            <ul className="text-sm text-gray-600 list-disc ml-5 mb-6 leading-relaxed">
              <li>We'll show a QR code — scan it with your app.</li>
              <li>Enter the 6-digit code your app generates to confirm.</li>
              <li>You'll get 10 one-time recovery codes — store them safely.</li>
            </ul>
            <button
              onClick={startSetup}
              disabled={submitting}
              className="btn-primary"
              data-testid="start-two-fa-setup-btn"
            >
              {submitting ? 'Generating…' : 'Begin setup'}
            </button>
          </>
        )}

        {setupData && (
          <>
            <p className="text-gray-600 mb-5">
              Scan this QR code with your authenticator app, then enter the 6-digit code below to confirm pairing.
            </p>
            <div className="grid md:grid-cols-2 gap-6 items-start">
              <div className="flex flex-col items-center">
                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                  <img src={setupData.qr_data_url} alt="2FA QR Code" className="w-52 h-52" data-testid="two-fa-qr-code" />
                </div>
                <div className="mt-4 text-xs text-gray-500 text-center">
                  Can't scan? Enter this secret manually:
                </div>
                <button
                  onClick={() => copy(setupData.secret)}
                  className="mt-2 hash-pill hover:bg-gray-200 font-mono text-xs inline-flex items-center gap-1.5"
                  data-testid="two-fa-secret-copy"
                  title="Click to copy"
                >
                  {setupData.secret} <Copy size={11} />
                </button>
              </div>

              <form onSubmit={verify} className="space-y-4">
                <div>
                  <label className="label-xs block mb-1.5">Enter the 6-digit code</label>
                  <div className="relative">
                    <Key size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text" required inputMode="numeric" autoFocus
                      pattern="[0-9]{6}" maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="input-axistra font-mono tracking-[0.5em] text-lg text-center"
                      style={{ paddingLeft: '3.6rem' }}
                      data-testid="two-fa-verify-code-input"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting || code.length !== 6}
                  className="btn-primary w-full"
                  data-testid="two-fa-verify-btn"
                >
                  {submitting ? 'Verifying…' : 'Verify & Enable 2FA'}
                </button>
                <button
                  type="button"
                  onClick={() => { setSetupData(null); setCode(''); }}
                  className="text-sm text-gray-500 hover:underline w-full text-center"
                >
                  ← Restart setup
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
