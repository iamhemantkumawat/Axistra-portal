import React, { useState } from 'react';
import api from '../../lib/api';
import { Modal, Field } from '../Atoms';
import { toast } from 'sonner';
import { ArrowsLeftRight } from '@phosphor-icons/react';

/**
 * Wio Bank internal FX modal — convert AED ↔ USD between the two Wio
 * sub-accounts. Posts to `/treasury/wio-fx` which creates a paired
 * convert_from / convert_to ledger entry on WIO_BANK.
 */
export function WioFxModal({ open, onClose, onSaved }) {
  const initial = {
    from_currency: 'AED',
    to_currency: 'USD',
    from_amount: '',
    to_amount: '',
    rate: '',
    reference: '',
    event_at: new Date().toISOString().slice(0, 10),
    notes: '',
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setForm(initial);
    onClose();
  };

  const swap = () => {
    setForm((f) => ({
      ...f,
      from_currency: f.to_currency,
      to_currency: f.from_currency,
      from_amount: f.to_amount,
      to_amount: f.from_amount,
    }));
  };

  // Auto-calc rate when both amounts entered
  const onAmtChange = (which, value) => {
    setForm((f) => {
      const next = { ...f, [which]: value };
      const fromA = parseFloat(which === 'from_amount' ? value : f.from_amount);
      const toA = parseFloat(which === 'to_amount' ? value : f.to_amount);
      if (fromA > 0 && toA > 0) next.rate = (toA / fromA).toFixed(6);
      return next;
    });
  };

  const onRateChange = (value) => {
    setForm((f) => {
      const next = { ...f, rate: value };
      const fromA = parseFloat(f.from_amount);
      const r = parseFloat(value);
      if (fromA > 0 && r > 0) next.to_amount = (fromA * r).toFixed(2);
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (form.from_currency === form.to_currency) {
      toast.error('From and To currencies must differ');
      return;
    }
    if (!(parseFloat(form.from_amount) > 0) || !(parseFloat(form.to_amount) > 0)) {
      toast.error('Both amounts must be positive');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/treasury/wio-fx', {
        from_currency: form.from_currency,
        to_currency: form.to_currency,
        from_amount: form.from_amount,
        to_amount: form.to_amount,
        rate: form.rate,
        reference: form.reference,
        event_at: form.event_at,
        notes: form.notes,
      });
      toast.success(`Converted ${form.from_amount} ${form.from_currency} → ${form.to_amount} ${form.to_currency}`);
      onSaved?.(data);
      handleClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'FX failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Wio Bank — AED ↔ USD Exchange" testId="wio-fx-modal">
      <p className="text-xs text-gray-500 mb-4">
        Records an internal currency conversion between your Wio AED and Wio USD sub-accounts.
        No funds leave the bank — the ledger debits one currency and credits the other.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="From">
          <div className="flex gap-2">
            <select
              className="input-axistra flex-shrink-0 w-24"
              value={form.from_currency}
              onChange={(e) => setForm({ ...form, from_currency: e.target.value })}
              data-testid="wio-fx-from-currency"
            >
              <option value="AED">AED</option>
              <option value="USD">USD</option>
            </select>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              className="input-axistra flex-1"
              placeholder="Amount"
              value={form.from_amount}
              onChange={(e) => onAmtChange('from_amount', e.target.value)}
              data-testid="wio-fx-from-amount"
            />
          </div>
        </Field>
        <div className="flex items-end justify-center pb-2">
          <button type="button" onClick={swap} className="btn-secondary inline-flex items-center gap-1.5" data-testid="wio-fx-swap">
            <ArrowsLeftRight size={14} /> Swap
          </button>
        </div>
        <Field label="To">
          <div className="flex gap-2">
            <select
              className="input-axistra flex-shrink-0 w-24"
              value={form.to_currency}
              onChange={(e) => setForm({ ...form, to_currency: e.target.value })}
              data-testid="wio-fx-to-currency"
            >
              <option value="AED">AED</option>
              <option value="USD">USD</option>
            </select>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              className="input-axistra flex-1"
              placeholder="Amount"
              value={form.to_amount}
              onChange={(e) => onAmtChange('to_amount', e.target.value)}
              data-testid="wio-fx-to-amount"
            />
          </div>
        </Field>
        <Field label={`Rate (1 ${form.from_currency} = ? ${form.to_currency})`}>
          <input
            type="number"
            step="0.000001"
            className="input-axistra"
            placeholder="auto-calculated"
            value={form.rate}
            onChange={(e) => onRateChange(e.target.value)}
            data-testid="wio-fx-rate"
          />
        </Field>
        <Field label="Bank Reference (optional)">
          <input
            className="input-axistra font-mono"
            placeholder="Wio FX confirmation"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            data-testid="wio-fx-reference"
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="input-axistra"
            value={form.event_at}
            onChange={(e) => setForm({ ...form, event_at: e.target.value })}
            data-testid="wio-fx-date"
          />
        </Field>
        <Field label="Notes" span={2}>
          <textarea
            rows={2}
            className="input-axistra"
            placeholder="Optional context — e.g. 'Bought USD for AWS bill'"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            data-testid="wio-fx-notes"
          />
        </Field>
        <div className="md:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary" data-testid="wio-fx-submit">
            {busy ? 'Recording…' : 'Record FX'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
