import React from 'react';
import { Badge, KpiCard } from '../Atoms';
import { Bank, Buildings, Coin } from '@phosphor-icons/react';
import { fmtNumber, fmtDate } from '../../lib/format';
import { BatchStatus } from './Atoms';

/**
 * AED & Wio tab — the "what's parked where" view.
 * Top: three KPI cards summarising AED-equivalent positions across
 * Wio bank, both exchanges (as AED), and USDT still on exchanges.
 * Left panel: USDT/AED batches awaiting Wio remittance.
 * Right panel: every Wio AED deposit (from batches AND standalone cashouts),
 * with a "Import Wio Statement" entry point.
 *
 * Read-only inputs plus two handlers:
 *   • openBatch(batch)          – open the settlement modal for a queue row
 *   • openImportBank()          – open the Wio Statement importer
 */
export function AedWioTab({
  batches,
  wioLedger,
  okxLedger,
  binanceLedger,
  openBatch,
  openImportBank,
}) {
  const pendingExchangeAed = [...okxLedger, ...binanceLedger]
    .reduce((acc, r) => acc + (r.coin === 'AED' ? parseFloat(r.amount || 0) : 0), 0);
  const pendingExchangeUsdt = [...okxLedger, ...binanceLedger]
    .reduce((acc, r) => acc + (r.coin === 'USDT' ? parseFloat(r.amount || 0) : 0), 0);
  const wioAed = wioLedger.reduce((acc, r) => acc + (r.coin === 'AED' ? parseFloat(r.amount || 0) : 0), 0);

  // USDT batches waiting for AED cashout
  const ready = batches.filter((b) => {
    if (b.bank_reference) return false;
    if (b.status === 'converted_to_usdt') return true;
    if (b.status === 'converted_to_aed' && !b.bank_reference) return true;
    return false;
  });

  // Merge sources for Wio deposits panel
  const fromBatches = batches.filter((b) => b.bank_reference).map((b) => ({
    kind: 'batch',
    id: b.id,
    ref_code: b.batch_code,
    ref: b.bank_reference,
    when: b.bank_deposit_date || b.updated_at || b.created_at,
    amount: parseFloat(b.net_bank_deposit_amount || b.fiat_received || 0),
    fee: parseFloat(b.bank_fee_aed || 0),
    counterparty: b.source_wallet || b.destination_exchange,
  }));
  const fromLedger = wioLedger
    .filter((r) => r.tx_type === 'bank_deposit' && r.coin === 'AED')
    .map((r) => ({
      kind: 'ledger',
      id: r.id,
      ref_code: r.external_ref,
      ref: r.tx_hash || r.external_ref,
      when: r.event_at,
      amount: parseFloat(r.amount || 0),
      fee: 0,
      counterparty: r.counterparty,
      notes: r.notes,
    }));
  const seenRefs = new Set(fromBatches.map((b) => b.ref).filter(Boolean));
  const merged = [
    ...fromBatches,
    ...fromLedger.filter((r) => !seenRefs.has(r.ref) && !seenRefs.has(r.ref_code)),
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  const totalIn = merged.reduce((acc, r) => acc + r.amount, 0);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <KpiCard label="AED held on Wio Bank" value={`AED ${fmtNumber(wioAed)}`} icon={Bank} accent testId="treasury-wio-aed" />
        <KpiCard label="AED waiting on exchanges" value={`AED ${fmtNumber(pendingExchangeAed)}`} sub={pendingExchangeAed > 100 ? 'Cashout pending — withdraw to Wio' : 'All flushed to Wio'} icon={Buildings} testId="treasury-exchange-aed" />
        <KpiCard label="USDT on exchanges" value={`${fmtNumber(pendingExchangeUsdt)} USDT`} sub="Convert to AED before cashout" icon={Coin} testId="treasury-exchange-usdt" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card-axistra p-5">
          <div className="label-xs mb-1">AED Conversion Queue</div>
          <h2 className="font-display text-xl font-bold text-gray-900 mb-1">USDT ready for AED conversion</h2>
          <p className="text-xs text-gray-500 mb-4">Batches sitting on an exchange in USDT, waiting to be sold for AED and remitted to Wio. Completed cashouts move to the right panel.</p>
          <div className="space-y-3">
            {ready.length === 0 ? (
              <div className="text-sm text-gray-500">All converted batches have been deposited to Wio. Nothing pending.</div>
            ) : ready.map((b) => (
              <button key={b.id} onClick={() => openBatch(b)} className="w-full rounded-md border border-gray-200 p-4 text-left hover:border-axistra-green transition-colors" data-testid={`aed-queue-${b.batch_code}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-axistra-green">{b.batch_code}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {b.status === 'converted_to_aed'
                        ? `${fmtNumber(b.fiat_received || 0)} AED ready · awaiting Wio deposit`
                        : `${fmtNumber(b.usdt_amount || b.crypto_converted || 0)} USDT on ${b.destination_exchange || 'exchange'}`}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(b.usdt_conversion_date || b.exchange_received_at || b.created_at)}</div>
                  </div>
                  <BatchStatus status={b.status} />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card-axistra p-5">
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <div>
              <div className="label-xs mb-1">Bank Evidence</div>
              <h2 className="font-display text-xl font-bold text-gray-900">Recent Wio deposits</h2>
            </div>
            <button onClick={openImportBank} className="btn-secondary text-xs inline-flex items-center gap-1.5" data-testid="aed-import-bank">
              Import Wio Statement
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-4">Every AED credit into the Wio settlement bank — from batch flows AND standalone cashouts.</p>
          <div className="space-y-3">
            {merged.length === 0 ? (
              <div className="text-sm text-gray-500">No Wio bank references recorded yet.</div>
            ) : (
              <>
                <div className="rounded-md bg-[var(--axistra-green-light)] px-4 py-2 text-xs text-gray-700 flex items-center justify-between">
                  <span>{merged.length} deposit{merged.length === 1 ? '' : 's'}</span>
                  <span className="font-mono font-semibold">+ AED {fmtNumber(totalIn)}</span>
                </div>
                {merged.map((r) => (
                  <div key={`${r.kind}-${r.id}`} className="rounded-md border border-gray-200 p-4" data-testid={`wio-row-${r.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-axistra-green truncate">{r.ref_code}</div>
                        {r.counterparty && (
                          <div className="text-xs text-gray-500 mt-0.5">From {r.counterparty}</div>
                        )}
                        <div className="text-sm text-gray-600 mt-1">Ref {r.ref}</div>
                        <div className="text-xs text-gray-500">
                          {fmtDate(r.when)}{r.fee > 0 ? ` · Fee AED ${fmtNumber(r.fee)}` : ''}
                          <Badge className={r.kind === 'batch' ? 'badge-success ml-2' : 'badge-info ml-2'}>{r.kind === 'batch' ? 'Batch' : 'Cashout'}</Badge>
                        </div>
                        {r.notes && <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">{r.notes}</div>}
                      </div>
                      <div className="font-mono text-sm font-semibold whitespace-nowrap">+ {fmtNumber(r.amount)} AED</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
