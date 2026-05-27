import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import { ShieldCheck, Lock, Envelope } from '@phosphor-icons/react';

const LOGO_URL = '/axistra-logo.png';

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success('Welcome back to Axistra Portal');
      nav('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid credentials');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Left brand panel */}
      <div className="hidden md:flex flex-col justify-between bg-[var(--axistra-green)] text-white p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #D4AF37 0%, transparent 40%), radial-gradient(circle at 80% 70%, #ffffff 0%, transparent 30%)' }} />
        <div className="flex items-center gap-3 relative">
          <img src={LOGO_URL} alt="Axistra" className="w-14 h-14 rounded-lg bg-white p-1.5" />
          <div>
            <div className="font-display text-2xl font-bold tracking-tight">AXISTRA</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--axistra-gold)] mt-1">Technologies — FZCO</div>
          </div>
        </div>

        <div className="relative">
          <h1 className="font-display text-4xl lg:text-5xl font-bold leading-tight">
            Compliance &amp;<br />
            <span className="text-[var(--axistra-gold)]">Accounting Portal</span>
          </h1>
          <p className="mt-6 text-gray-200 max-w-md leading-relaxed">
            End-to-end audit trail from customer payment through OKX conversion
            to Wio bank deposit — engineered for UAE financial compliance.
          </p>
          <div className="mt-10 flex items-center gap-2 text-[var(--axistra-gold)] text-sm">
            <ShieldCheck size={20} weight="duotone" />
            <span className="uppercase tracking-[0.2em] text-xs font-semibold">Innovate · Connect · Grow</span>
          </div>
        </div>

        <div className="relative text-[11px] text-gray-300 border-t border-[#117852] pt-4">
          IFZA / Dubai Integrated Economic Zones Authority<br />
          Corporate Tax Registration No: 105415374500001
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center p-6 md:p-12 bg-[var(--axistra-bg)]">
        <div className="w-full max-w-md">
          <div className="md:hidden flex items-center gap-3 mb-8">
            <img src={LOGO_URL} alt="Axistra" className="w-12 h-12" />
            <div>
              <div className="font-display text-xl font-bold text-axistra-green">AXISTRA</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Compliance Portal</div>
            </div>
          </div>

          <h2 className="font-display text-3xl font-bold text-gray-900">Welcome back</h2>
          <p className="text-gray-600 mt-2 mb-8">Sign in with your administrator credentials.</p>

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <label className="label-xs block mb-1.5">Email</label>
              <div className="relative">
                <Envelope size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-axistra"
                  style={{ paddingLeft: '3.6rem' }}
                  data-testid="login-email-input"
                />
              </div>
            </div>

            <div>
              <label className="label-xs block mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-axistra"
                  style={{ paddingLeft: '3.6rem' }}
                  data-testid="login-password-input"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                required
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-axistra-green focus:ring-axistra-green"
                data-testid="login-terms-checkbox"
              />
              <span className="leading-relaxed">
                I agree to the{' '}
                <Link to="/terms-and-conditions" className="text-axistra-green underline underline-offset-2">
                  Terms &amp; Conditions
                </Link>
                {' '}and{' '}
                <Link to="/privacy-policy" className="text-axistra-green underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting || !acceptTerms}
              className="btn-primary w-full py-3"
              data-testid="login-submit-btn"
            >
              {submitting ? 'Authenticating…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
