import React, { useState } from 'react';
import api from '../../lib/api';
import { Modal, Field } from '../Atoms';
import { toast } from 'sonner';

/**
 * Wio Bank standalone deposit recorder — supports both AED and USD.
 * Use this for direct bank credits not flowing through a treasury batch
 * (foreign-wire customer payments, refunds, capital injections, etc).
 * Idempotent on bank reference so re-posting the same Wio receipt ID
 * is a no-op.
 */
export function WioDepositModal({ open, onClose, onSaved, defaultCurrency = 'AED' }) {
  const initial = {
    currency: defaultCurrency,
    amount: '',
    reference: '',
    counterparty: '',
    event_at: new Date().toISOString().slice(0, 10),
    notes: '',
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setForm(initial);
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!(parseFloat(form.amount) > 0)) { toast.error('Amount must be positive'); return; }
    if (!form.reference.trim()) { toast.error('Bank reference is required'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/treasury/wio-deposit', form);
      if (data?.duplicate) {
        toast.info(`Reference already recorded (${data.currency} ${data.amount})`);
      } else {
        toast.success(`Recorded ${form.amount} ${form.currency} deposit`);
      }
      onSaved?.(data);
      handleClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Deposit failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Wio Bank — Manual Deposit" testId="wio-deposit-modal">
      <p className="text-xs text-gray-500 mb-4">
        Record a direct bank credit on the Wio AED or USD sub-account. For customer wires that don&apos;t
        flow through a treasury batch. Same reference can&apos;t be posted twice.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Currency">
          <select
            className="input-axistra"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            data-testid="wio-deposit-currency"
          >
            <option value="AED">AED</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Amount">
          <input
            required
            type="number"
            step="0.01"
            min="0"
            className="input-axistra"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            data-testid="wio-deposit-amount"
          />
        </Field>
        <Field label="Bank Reference / Receipt ID" span={2}>
          <input
            required
            className="input-axistra font-mono"
            placeholder="Wio reference"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            data-testid="wio-deposit-reference"
          />
        </Field>
        <Field label="Counterparty / Sender">
          <input
            className="input-axistra"
            placeholder="e.g. ABC Corp wire"
            value={form.counterparty}
            onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
            data-testid="wio-deposit-counterparty"
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="input-axistra"
            value={form.event_at}
            onChange={(e) => setForm({ ...form, event_at: e.target.value })}
            data-testid="wio-deposit-date"
          />
        </Field>
        <Field label="Notes" span={2}>
          <textarea
            rows={2}
            className="input-axistra"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            data-testid="wio-deposit-notes"
          />
        </Field>
        <div className="md:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary" data-testid="wio-deposit-submit">
            {busy ? 'Saving…' : 'Record Deposit'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
