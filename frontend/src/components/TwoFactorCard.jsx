import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal, Field } from './Atoms';
import { ShieldCheck, ShieldSlash, Key, Warning, Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';

export default function TwoFactorCard() {
  const { user, refreshUser } = useAuth();
  const nav = useNavigate();
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newCodes, setNewCodes] = useState(null);

  const enabled = !!user?.two_fa_enabled;

  const onDisable = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/auth/2fa/disable', useRecovery
        ? { recovery_code: recoveryCode }
        : { code });
      toast.success('Two-factor authentication disabled');
      await refreshUser();
      setDisableOpen(false);
      setCode(''); setRecoveryCode(''); setUseRecovery(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  const onRegen = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/2fa/recovery-codes/regenerate', { code });
      setNewCodes(data.recovery_codes);
      setCode('');
      toast.success('New recovery codes generated — old ones are now invalid');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('Copied'); };

  return (
    <div className="card-axistra p-6 lg:col-span-2" data-testid="two-fa-card">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            {enabled ? (
              <ShieldCheck size={20} weight="duotone" className="text-axistra-green" />
            ) : (
              <ShieldSlash size={20} weight="duotone" className="text-yellow-600" />
            )}
            Two-Factor Authentication
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {enabled
              ? 'Your account is protected with an authenticator app (TOTP).'
              : user?.enforce_admin_2fa && user?.role === 'admin'
                ? 'Required for admin accounts. Enable it now to keep access to the portal.'
                : 'Add a second factor to harden your account.'}
          </p>
        </div>
        <span className={`badge ${enabled ? 'badge-success' : 'badge-neutral'}`} data-testid="two-fa-status-badge">
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {!enabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => nav('/setup-2fa')}
            className="btn-primary inline-flex items-center gap-2"
            data-testid="enable-two-fa-btn"
          ><ShieldCheck size={16} /> Enable 2FA</button>
        </div>
      )}

      {enabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setRegenOpen(true)}
            className="btn-secondary inline-flex items-center gap-2"
            data-testid="regen-recovery-codes-btn"
          ><Key size={16} /> Regenerate recovery codes</button>
          <button
            onClick={() => setDisableOpen(true)}
            className="btn-secondary inline-flex items-center gap-2 text-red-700"
            data-testid="disable-two-fa-btn"
          ><ShieldSlash size={16} /> Disable 2FA</button>
        </div>
      )}

      {/* Disable Modal */}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Disable Two-Factor" testId="disable-two-fa-modal">
        <form onSubmit={onDisable} className="space-y-4">
          <div className="rounded-md border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 flex gap-2">
            <Warning size={20} weight="duotone" className="flex-shrink-0 mt-0.5" />
            <div>Disabling 2FA reduces your account security. Confirm with your current authenticator code or a recovery code.</div>
          </div>
          {!useRecovery ? (
            <Field label="Authenticator code">
              <input
                type="text" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input-axistra font-mono tracking-widest"
                data-testid="disable-two-fa-code-input"
                placeholder="123456"
              />
            </Field>
          ) : (
            <Field label="Recovery code">
              <input
                type="text" required value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                placeholder="XXXXX-XXXXX"
                className="input-axistra font-mono"
                data-testid="disable-two-fa-recovery-input"
              />
            </Field>
          )}
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => setUseRecovery(!useRecovery)} className="text-axistra-green hover:underline">
              {useRecovery ? 'Use authenticator code' : 'Use recovery code instead'}
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setDisableOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary bg-red-700 hover:bg-red-800" data-testid="disable-two-fa-confirm-btn">
              {submitting ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Regenerate Recovery Codes Modal */}
      <Modal open={regenOpen} onClose={() => { setRegenOpen(false); setNewCodes(null); }} title="Recovery codes" testId="regen-two-fa-modal" size="lg">
        {!newCodes ? (
          <form onSubmit={onRegen} className="space-y-4">
            <p className="text-sm text-gray-600">
              Generating new recovery codes will invalidate all previous ones. Confirm with your current authenticator code.
            </p>
            <Field label="Authenticator code">
              <input
                type="text" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input-axistra font-mono tracking-widest"
                data-testid="regen-two-fa-code-input"
                placeholder="123456"
              />
            </Field>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRegenOpen(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary" data-testid="regen-two-fa-confirm-btn">
                {submitting ? 'Generating…' : 'Generate new codes'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div className="rounded-md border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 mb-4 flex gap-2">
              <Warning size={20} weight="duotone" className="flex-shrink-0 mt-0.5" />
              <div>Save these codes now — each can be used once and we cannot show them again.</div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {newCodes.map((c) => (
                <div key={c} className="bg-gray-50 border border-gray-200 rounded px-4 py-2 font-mono text-sm flex items-center justify-between">
                  <span>{c}</span>
                  <button onClick={() => copy(c)} className="text-gray-400 hover:text-axistra-green"><Copy size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => copy(newCodes.join('\n'))} className="btn-secondary inline-flex items-center gap-2">
                <Copy size={14} /> Copy all
              </button>
              <button onClick={() => { setRegenOpen(false); setNewCodes(null); }} className="btn-primary">Done</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
