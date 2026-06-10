import React from 'react';
import { Badge, KpiCard } from '../Atoms';
import { Bank, Buildings, Coin, ArrowsLeftRight, Plus } from '@phosphor-icons/react';
import { fmtNumber, fmtDate } from '../../lib/format';
import { BatchStatus } from './Atoms';

/**
 * Wio Bank tab — multi-currency (AED + USD).
 *
 * Top row of KPI cards summarises:
 *   • AED held on Wio
 *   • USD held on Wio
 *   • AED waiting on exchanges (cashout pending)
 *   • USDT on exchanges (convert before cashout)
 *
 * Left panel: USDT/AED batches awaiting Wio remittance.
 * Right panel: every Wio deposit (AED + USD) sourced from batches AND
 *              standalone bank deposits. Each row labelled with currency.
 *
 * Handlers:
 *   • openBatch(batch)
 *   • openImportBank()
 *   • openWioFx()        — AED ↔ USD FX modal
 *   • openWioDeposit()   — manual standalone deposit modal
 */
export function AedWioTab({
  batches,
  wioLedger,
  okxLedger,
  binanceLedger,
  openBatch,
  openImportBank,
  openWioFx,
  openWioDeposit,
}) {
  const pendingExchangeAed = [...okxLedger, ...binanceLedger]
    .reduce((acc, r) => acc + (r.coin === 'AED' ? parseFloat(r.amount || 0) : 0), 0);
  const pendingExchangeUsdt = [...okxLedger, ...binanceLedger]
    .reduce((acc, r) => acc + (r.coin === 'USDT' ? parseFloat(r.amount || 0) : 0), 0);
  const wioAed = wioLedger.reduce((acc, r) => acc + (r.coin === 'AED' ? parseFloat(r.amount || 0) : 0), 0);
  const wioUsd = wioLedger.reduce((acc, r) => acc + (r.coin === 'USD' ? parseFloat(r.amount || 0) : 0), 0);

  // USDT/AED batches waiting for AED cashout
  const ready = batches.filter((b) => {
    if (b.bank_reference) return false;
    if (b.status === 'converted_to_usdt') return true;
    if (b.status === 'converted_to_aed' && !b.bank_reference) return true;
    return false;
  });

  // Merge sources for Wio deposits panel. Now currency-aware — keeps
  // each row's coin so the panel can label AED vs USD deposits.
  const fromBatches = batches.filter((b) => b.bank_reference).map((b) => ({
    kind: 'batch',
    id: b.id,
    ref_code: b.batch_code,
    ref: b.bank_reference,
    when: b.bank_deposit_date || b.updated_at || b.created_at,
    amount: parseFloat(b.net_bank_deposit_amount || b.fiat_received || 0),
    currency: 'AED', // batch flow has always been AED so far
    fee: parseFloat(b.bank_fee_aed || 0),
    counterparty: b.source_wallet || b.destination_exchange,
  }));
  const fromLedger = wioLedger
    .filter((r) => r.tx_type === 'bank_deposit' && (r.coin === 'AED' || r.coin === 'USD'))
    .map((r) => ({
      kind: 'ledger',
      id: r.id,
      ref_code: r.external_ref,
      ref: r.tx_hash || r.external_ref,
      when: r.event_at,
      amount: parseFloat(r.amount || 0),
      currency: r.coin,
      fee: 0,
      counterparty: r.counterparty,
      notes: r.notes,
    }));
  const fxRows = wioLedger
    .filter((r) => (r.tx_type === 'convert_from' || r.tx_type === 'convert_to') && r.counterparty?.startsWith('Wio FX'))
    .map((r) => ({
      kind: 'fx',
      id: r.id,
      ref_code: r.external_ref,
      ref: r.external_ref,
      when: r.event_at,
      amount: parseFloat(r.amount || 0),
      currency: r.coin,
      fee: 0,
      counterparty: r.counterparty,
      notes: r.notes,
    }));
  const seenRefs = new Set(fromBatches.map((b) => b.ref).filter(Boolean));
  const merged = [
    ...fromBatches,
    ...fromLedger.filter((r) => !seenRefs.has(r.ref) && !seenRefs.has(r.ref_code)),
    ...fxRows,
  ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  const totalInAed = merged.filter((r) => r.currency === 'AED').reduce((acc, r) => acc + Math.max(0, r.amount), 0);
  const totalInUsd = merged.filter((r) => r.currency === 'USD').reduce((acc, r) => acc + Math.max(0, r.amount), 0);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="AED held on Wio Bank" value={`AED ${fmtNumber(wioAed)}`} icon={Bank} accent testId="treasury-wio-aed" />
        <KpiCard label="USD held on Wio Bank" value={`USD ${fmtNumber(wioUsd)}`} sub={wioUsd > 0 ? 'Available for FX or wire-out' : 'No USD position'} icon={Bank} testId="treasury-wio-usd" />
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
              <h2 className="font-display text-xl font-bold text-gray-900">Recent Wio activity</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {openWioDeposit && (
                <button onClick={openWioDeposit} className="btn-secondary text-xs inline-flex items-center gap-1.5" data-testid="wio-deposit-open">
                  <Plus size={12} /> Deposit
                </button>
              )}
              {openWioFx && (
                <button onClick={openWioFx} className="btn-secondary text-xs inline-flex items-center gap-1.5" data-testid="wio-fx-open">
                  <ArrowsLeftRight size={12} /> FX
                </button>
              )}
              <button onClick={openImportBank} className="btn-secondary text-xs inline-flex items-center gap-1.5" data-testid="aed-import-bank">
                Import CSV
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">All credits & FX moves on the Wio Bank (AED + USD sub-accounts).</p>
          <div className="space-y-3">
            {merged.length === 0 ? (
              <div className="text-sm text-gray-500">No Wio bank references recorded yet.</div>
            ) : (
              <>
                <div className="rounded-md bg-[var(--axistra-green-light)] px-4 py-2 text-xs text-gray-700 flex items-center justify-between flex-wrap gap-2">
                  <span>{merged.length} entr{merged.length === 1 ? 'y' : 'ies'}</span>
                  <span className="font-mono font-semibold space-x-3">
                    {totalInAed > 0 && <>+ AED {fmtNumber(totalInAed)}</>}
                    {totalInUsd > 0 && <>+ USD {fmtNumber(totalInUsd)}</>}
                  </span>
                </div>
                {merged.map((r) => (
                  <div key={`${r.kind}-${r.id}`} className="rounded-md border border-gray-200 p-4" data-testid={`wio-row-${r.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-axistra-green truncate">{r.ref_code}</div>
                        {r.counterparty && (
                          <div className="text-xs text-gray-500 mt-0.5">{r.counterparty.startsWith('Wio FX') ? r.counterparty : `From ${r.counterparty}`}</div>
                        )}
                        <div className="text-sm text-gray-600 mt-1">Ref {r.ref}</div>
                        <div className="text-xs text-gray-500">
                          {fmtDate(r.when)}{r.fee > 0 ? ` · Fee AED ${fmtNumber(r.fee)}` : ''}
                          <Badge className={
                            r.kind === 'batch' ? 'badge-success ml-2' :
                            r.kind === 'fx' ? 'badge-warning ml-2' : 'badge-info ml-2'
                          }>
                            {r.kind === 'batch' ? 'Batch' : r.kind === 'fx' ? 'FX' : 'Deposit'}
                          </Badge>
                        </div>
                        {r.notes && <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">{r.notes}</div>}
                      </div>
                      <div className={`font-mono text-sm font-semibold whitespace-nowrap ${r.amount < 0 ? 'text-red-600' : ''}`}>
                        {r.amount >= 0 ? '+' : ''}{fmtNumber(r.amount)} {r.currency}
                      </div>
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
