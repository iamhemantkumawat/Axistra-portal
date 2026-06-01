import React from 'react';
import { Badge } from '../Atoms';
import { statusMeta } from './utils';

/**
 * Treasury page atoms — small presentational components extracted from
 * Treasury.jsx. Stateless, prop-driven, safe to share with sub-pages.
 */

export function BatchStatus({ status, fiatCurrency }) {
  const meta = statusMeta(status);
  // For direct crypto → non-AED fiat batches, override the label so it reads
  // "Converted to USD" / "Converted to EUR" instead of the legacy "AED".
  const label = (status === 'converted_to_aed' && fiatCurrency && fiatCurrency !== 'AED')
    ? `Converted to ${fiatCurrency}`
    : meta.label;
  return <Badge className={meta.cls}>{label}</Badge>;
}

export function StepPill({ icon: Icon, label, sub }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--axistra-green-light)] text-axistra-green">
        <Icon size={18} weight="duotone" />
      </div>
      <div>
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-500">{sub}</div>
      </div>
    </div>
  );
}
