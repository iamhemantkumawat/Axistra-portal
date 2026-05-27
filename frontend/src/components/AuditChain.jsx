import React from 'react';
import { CheckCircle } from '@phosphor-icons/react';

// Renders the sale proof chain plus the later treasury settlement layer.
// Customer payment TX and treasury settlement TX are separate evidence.
export default function AuditChain({ recharge, treasury, invoice, crypto }) {
  const steps = [
    { key: 'customer', label: 'Customer', done: !!recharge?.customer_id },
    { key: 'invoice', label: 'Invoice', done: !!invoice?.id || !!recharge?.invoice_id },
    { key: 'crypto', label: 'Payment TX', done: !!(crypto?.length || recharge?.tx_hash) },
    { key: 'magnus', label: 'Magnus Credit', done: !!recharge?.magnus_credited_at },
    { key: 'batch', label: 'Treasury Batch', done: !!treasury?.treasury_batch_id || !!treasury?.transferred_to_okx },
    { key: 'settlement', label: 'OKX / Bank', done: !!treasury?.transferred_to_wio || recharge?.reconciled },
  ];

  const lastDone = (() => {
    let i = -1;
    steps.forEach((s, idx) => { if (s.done) i = idx; });
    return i;
  })();

  return (
    <div className="card-axistra p-6" data-testid="audit-chain">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="label-xs">Audit Chain</div>
          <h3 className="font-display text-xl font-semibold text-gray-900 mt-0.5">Customer → Invoice → Payment TX → Magnus → Batch → OKX/Wio</h3>
        </div>
        <div className="text-right">
          <div className="label-xs">Progress</div>
          <div className="font-display text-2xl font-bold text-axistra-green">{lastDone + 1} <span className="text-gray-400 text-base">/ {steps.length}</span></div>
        </div>
      </div>

      <div className="flex items-start relative">
        {steps.map((s, i) => {
          const isCurrent = !s.done && i === lastDone + 1;
          return (
            <div key={s.key} className={`audit-step ${s.done ? 'done' : ''} ${isCurrent ? 'current' : ''}`} data-testid={`audit-step-${s.key}`}>
              {i < steps.length - 1 && <div className="audit-line" />}
              <div className="node">
                {s.done ? <CheckCircle size={20} weight="fill" /> : i + 1}
              </div>
              <div className="label">{s.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
