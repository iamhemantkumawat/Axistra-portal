import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Modal, Field, Hash } from '../components/Atoms';
import { fmtDate, fmtMoney } from '../lib/format';
import { Plus } from '@phosphor-icons/react';
import { toast } from 'sonner';

const CATEGORIES = ['VPS', 'Vendor', 'Software', 'Salary', 'Office', 'BankCharges', 'ExchangeFees', 'Legal', 'Marketing', 'Other'];
const empty = {
  expense_date: new Date().toISOString().slice(0, 10),
  vendor_name: '', category: 'VPS', amount: '', currency: 'AED',
  payment_method: 'Bank', paid_in_usdt: false, vendor_wallet: '',
  crypto_network: 'TRC20', tx_hash: '', aed_rate: '', aed_value: '',
  bank_reference: '', notes: '',
};

export default function Expenses() {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);

  const load = () => {
    const p = {};
    if (category) p.category = category;
    if (search) p.search = search;
    api.get('/expenses', { params: p }).then((r) => setItems(r.data));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/expenses', form);
      toast.success('Expense recorded');
      setOpen(false); setForm(empty); load();
    } catch { toast.error('Failed'); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Spend"
        title="Expenses"
        subtitle="Track operational, vendor, and crypto-paid expenses with AED equivalent for accounting."
        actions={<button onClick={() => setOpen(true)} className="btn-primary inline-flex items-center gap-2" data-testid="add-expense-btn"><Plus size={16} /> Add Expense</button>}
      />

      <div className="card-axistra p-4 mb-4 flex flex-col md:flex-row gap-3">
        <input placeholder="Search vendor, notes, TX…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} className="input-axistra flex-1" data-testid="expense-search" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-axistra md:w-56" data-testid="expense-category-filter">
          <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={load} className="btn-secondary">Apply</button>
      </div>

      <div className="card-axistra overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Method</th><th>AED Value</th><th>TX/Ref</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="7" className="text-center text-gray-500 py-10">No expenses recorded.</td></tr>}
            {items.map((e) => (
              <tr key={e.id} data-testid={`expense-row-${e.id}`}>
                <td className="text-sm">{fmtDate(e.expense_date)}</td>
                <td className="font-medium">{e.vendor_name}</td>
                <td><span className="badge badge-neutral">{e.category}</span></td>
                <td className="font-mono">{fmtMoney(e.amount, e.currency)}</td>
                <td className="text-xs">{e.payment_method}{e.paid_in_usdt && ' · USDT'}</td>
                <td className="font-mono text-sm">{e.aed_value ? `${parseFloat(e.aed_value).toLocaleString()} AED` : '—'}</td>
                <td>{e.tx_hash ? <Hash value={e.tx_hash} /> : <span className="text-xs text-gray-500">{e.bank_reference || '—'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Expense" testId="expense-modal">
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label="Date *"><input type="date" required className="input-axistra" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} data-testid="exp-form-date" /></Field>
          <Field label="Vendor *"><input required className="input-axistra" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} data-testid="exp-form-vendor" /></Field>
          <Field label="Category"><select className="input-axistra" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="exp-form-category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Payment Method"><select className="input-axistra" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value, paid_in_usdt: e.target.value === 'USDT' })} data-testid="exp-form-method"><option>Bank</option><option>Card</option><option>USDT</option><option>Cash</option><option>Other</option></select></Field>
          <Field label="Amount *"><input required type="number" step="0.01" className="input-axistra" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="exp-form-amount" /></Field>
          <Field label="Currency"><select className="input-axistra" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} data-testid="exp-form-currency"><option>AED</option><option>USD</option><option>EUR</option><option>USDT</option></select></Field>
          {(form.payment_method === 'USDT' || form.payment_method === 'BinancePay') && (
            <>
              <Field label="Vendor Wallet / Pay ID" span={2}><input className="input-axistra font-mono" value={form.vendor_wallet} onChange={(e) => setForm({ ...form, vendor_wallet: e.target.value })} data-testid="exp-form-wallet" /></Field>
              <Field label="Network">
                <select className="input-axistra" value={form.crypto_network} onChange={(e) => setForm({ ...form, crypto_network: e.target.value })}>
                  <option>TRC20</option><option>ERC20</option><option>BEP20</option><option>BinancePay</option>
                </select>
              </Field>
              <Field label="TX Hash / Order ID"><input className="input-axistra font-mono" value={form.tx_hash} onChange={(e) => setForm({ ...form, tx_hash: e.target.value })} data-testid="exp-form-tx" /></Field>
            </>
          )}
          {form.payment_method === 'Card' && (
            <Field label="Card Reference / Last 4" span={2}><input className="input-axistra font-mono" value={form.bank_reference} onChange={(e) => setForm({ ...form, bank_reference: e.target.value })} placeholder="**** 1234 / receipt #" data-testid="exp-form-card-ref" /></Field>
          )}
          <Field label="AED Rate"><input className="input-axistra" value={form.aed_rate} onChange={(e) => setForm({ ...form, aed_rate: e.target.value })} placeholder="3.67" data-testid="exp-form-rate" /></Field>
          <Field label="Bank Reference"><input className="input-axistra" value={form.bank_reference} onChange={(e) => setForm({ ...form, bank_reference: e.target.value })} /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="exp-form-submit">{loading ? 'Saving…' : 'Add Expense'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
