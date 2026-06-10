import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { CheckCircle, Clock, WarningCircle, ArrowRight, Receipt, FileText, Wallet, ArrowsLeftRight, CurrencyCircleDollar, Bank } from '@phosphor-icons/react';
import { fmtDate } from '../lib/format';
import { Link } from 'react-router-dom';

const STAGE_ICONS = {
  customer: Receipt,
  invoice: FileText,
  gateway: Wallet,
  magnus: CheckCircle,
  sweep: ArrowsLeftRight,
  usdt: ArrowsLeftRight,
  aed: CurrencyCircleDollar,
  conversion: ArrowsLeftRight,
  wio: Bank,
};

/**
 * Rich 7-step audit chain widget for the Recharge Detail page.
 * Fetches /api/treasury/chain/:id and renders every stage with the
 * transfer ID / reference, timestamp and human-readable detail line.
 * This is what makes the "where did the money go" question answerable
 * in one glance — each stage carries its batch_code / ledger ref so
 * the operator can drill down further if needed.
 */
export default function RechargeAuditChainFull({ rechargeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rechargeId) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get(`/treasury/chain/${rechargeId}`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rechargeId]);

  if (loading) {
    return (
      <div className="card-axistra p-6 text-center text-sm text-gray-500">Loading chain…</div>
    );
  }
  if (!data?.chain?.length) {
    return null;
  }

  const doneCount = data.chain.filter((c) => c.status === 'done').length;
  const total = data.chain.length;

  return (
    <div className="card-axistra p-6" data-testid="recharge-chain">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <div className="label-xs">Where did the money go?</div>
          <h3 className="font-display text-xl font-semibold text-gray-900 mt-0.5">Audit chain — every transfer reference</h3>
        </div>
        <div className="text-right">
          <div className="label-xs">Progress</div>
          <div className="font-display text-2xl font-bold text-axistra-green">{doneCount}<span className="text-gray-400 text-base"> / {total}</span></div>
        </div>
      </div>

      <ol className="space-y-2">
        {data.chain.map((link, i) => {
          const Icon = STAGE_ICONS[link.stage] || ArrowRight;
          const isDone = link.status === 'done';
          const isPending = link.status === 'pending';
          const isMismatch = link.status === 'mismatch';
          const cls = isDone
            ? 'border-green-300 bg-green-50/60 text-green-900'
            : isPending
              ? 'border-amber-200 bg-amber-50/60 text-amber-900'
              : isMismatch
                ? 'border-red-300 bg-red-50/60 text-red-900'
                : 'border-gray-200 bg-gray-50 text-gray-700';
          const StatusIcon = isDone ? CheckCircle : isPending ? Clock : isMismatch ? WarningCircle : Icon;
          return (
            <li key={`${link.stage}-${i}`} className={`flex items-start gap-3 rounded-md border px-4 py-3 ${cls}`} data-testid={`recharge-chain-${link.stage}-${i}`}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-current shrink-0">
                <StatusIcon size={18} weight={isDone ? 'fill' : 'regular'} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="font-semibold">{i + 1}. {link.label}</span>
                  {link.when && <span className="text-[11px] opacity-75 font-mono">{fmtDate(link.when)}</span>}
                </div>
                {link.ref && (
                  <div className="font-mono text-xs mt-0.5 break-all">
                    {/* Make batch codes navigable to the Treasury tab */}
                    {String(link.ref).match(/^(BIN|OKX|BPAY|OPAY|OXA|BTC)/i) ? (
                      <Link to="/treasury" className="hover:underline">{link.ref}</Link>
                    ) : (
                      link.ref
                    )}
                  </div>
                )}
                {link.detail && <div className="text-xs mt-0.5 opacity-85">{link.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
