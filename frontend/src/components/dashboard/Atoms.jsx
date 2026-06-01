import React from 'react';
import { fmtNumber } from '../../lib/format';

/**
 * Small, reusable building blocks for the Dashboard. Extracted so the main
 * page reads as composition instead of being a 350-line wall of JSX.
 */

export function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      {Icon && <Icon size={14} weight="duotone" className="text-axistra-green" />}
      <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-semibold">{children}</span>
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sub, delta, accent, testId }) {
  const deltaText = (() => {
    if (delta === null || delta === undefined) return null;
    const sign = delta >= 0 ? '+' : '';
    return { text: `${sign}${delta.toFixed(1)}%`, positive: delta >= 0 };
  })();
  return (
    <div
      className={`card-axistra p-4 relative overflow-hidden ${accent ? 'bg-gradient-to-br from-[var(--axistra-green-light)] to-white border-axistra-green/20' : ''}`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-500 font-semibold">
          {Icon && <Icon size={14} weight="duotone" className={accent ? 'text-axistra-green' : 'text-gray-400'} />}
          <span>{label}</span>
        </div>
        {deltaText && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${deltaText.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {deltaText.text}
          </span>
        )}
      </div>
      <div className={`font-display font-bold mt-2 text-2xl ${accent ? 'text-axistra-green' : 'text-gray-900'} truncate`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}

export function CurrencyBreakdown({ items = [], count }) {
  if (!items || items.length === 0) return <span>{count} recharge(s)</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      <span className="text-gray-500">{count} recharge(s) ·</span>
      {items.map((b) => (
        <span key={b.currency} className="text-gray-700">
          <span className="font-mono">{Number(b.amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> <span className="text-[10px] uppercase text-gray-400">{b.currency}</span>
        </span>
      ))}
    </span>
  );
}

export function VatBar({ pct, ytd, cap }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500">{fmtNumber(ytd)} / {fmtNumber(cap)} AED</div>
      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--axistra-green)] to-[var(--axistra-gold)] transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
