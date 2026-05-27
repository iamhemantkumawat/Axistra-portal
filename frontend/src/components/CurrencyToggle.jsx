import React from 'react';
import { useCurrency } from '../lib/currency';
import { CurrencyCircleDollar } from '@phosphor-icons/react';

export default function CurrencyToggle() {
  const { display, change } = useCurrency();
  const options = ['USD', 'EUR', 'AED', 'INR'];
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200" data-testid="currency-toggle">
      <CurrencyCircleDollar size={14} className="text-gray-500 ml-1.5" />
      {options.map((c) => (
        <button
          key={c}
          onClick={() => change(c)}
          data-testid={`currency-toggle-${c}`}
          className={`px-2.5 py-1 text-[11px] font-semibold rounded-sm transition-colors ${
            display === c
              ? 'bg-[var(--axistra-green)] text-white shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
