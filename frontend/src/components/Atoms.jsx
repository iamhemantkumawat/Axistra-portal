import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export const PageHeader = ({ title, subtitle, actions, eyebrow }) => (
  <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
    <div>
      {eyebrow && <div className="label-xs mb-1">{eyebrow}</div>}
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">{title}</h1>
      {subtitle && <p className="text-gray-600 mt-2 max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const Badge = ({ className = 'badge-neutral', children, testId }) => (
  <span className={`badge ${className}`} data-testid={testId}>{children}</span>
);

export const Hash = ({ value, testId }) => {
  const [copied, setCopied] = React.useState(false);
  if (!value) return <span className="text-gray-400 text-xs">—</span>;
  const onCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button onClick={onCopy} title="Copy" data-testid={testId} className="hash-pill hover:bg-gray-200 inline-flex items-center gap-1.5">
      <span>{value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value}</span>
      <span className="text-[9px] uppercase text-gray-500">{copied ? 'copied' : 'copy'}</span>
    </button>
  );
};

export const EmptyState = ({ title, hint }) => (
  <div className="card-axistra p-10 text-center">
    <div className="font-display text-lg font-semibold text-gray-700">{title}</div>
    {hint && <div className="text-sm text-gray-500 mt-1">{hint}</div>}
  </div>
);

export const Modal = ({ open, onClose, title, children, testId, size = 'md' }) => {
  // Lock body scroll while a modal is open so the page underneath can't be
  // scrolled into view (which would expose content past the fixed dim overlay).
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  const width = size === 'lg' ? 'max-w-4xl' : size === 'xl' ? 'max-w-6xl' : 'max-w-2xl';
  // Render through a portal at the document body so the modal escapes any
  // ancestor stacking context (cards with `transform`/`opacity`/etc. that
  // would otherwise allow the page content to bleed over the modal).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" data-testid={testId} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* flex column with max-h so header stays put and body scrolls — keeps the
          submit/save button row always visible at the bottom of the viewport. */}
      <div className={`bg-white rounded-lg shadow-2xl w-full ${width} max-h-[90vh] flex flex-col relative z-[101]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-display text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" data-testid="modal-close-btn">✕</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export const Field = ({ label, children, span = 1 }) => (
  <div className={span === 2 ? 'md:col-span-2' : ''}>
    <label className="label-xs block mb-1.5">{label}</label>
    {children}
  </div>
);

export const KpiCard = ({ label, value, sub, accent, icon: Icon, testId }) => (
  <div className="card-axistra p-5" data-testid={testId}>
    <div className="flex items-start justify-between">
      <div>
        <div className="label-xs">{label}</div>
        <div className={`mt-2 font-display text-2xl font-bold ${accent ? 'text-axistra-gold' : 'text-gray-900'}`}>{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
      </div>
      {Icon && <div className="w-10 h-10 rounded-lg bg-[var(--axistra-green-light)] text-axistra-green flex items-center justify-center"><Icon size={20} weight="duotone" /></div>}
    </div>
  </div>
);
