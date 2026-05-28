import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Modal, Field, Hash } from '../components/Atoms';
import { fmtDate, fmtMoney } from '../lib/format';
import { Plus, Info, PencilSimple, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';

const CATEGORIES = ['VPS', 'Vendor', 'Software', 'Salary', 'Office', 'BankCharges', 'ExchangeFees', 'Legal', 'Marketing', 'Other'];
const BANKS = ['Wio Bank']; // extend later as needed
const SOURCE_WALLETS = ['BINANCE', 'OKX', 'OXAPAY', 'BTCPAY'];

const empty = {
  expense_date: new Date().toISOString().slice(0, 10),
  vendor_id: '',
  vendor_name: '',
  category: 'VPS',
  amount: '',
  currency: 'AED',
  payment_method: 'Bank',
  bank_name: '',
  source_wallet: '',
  vendor_wallet: '',
  crypto_network: 'TRC20',
  tx_hash: '',
  notes: '',
};

const PAYMENT_METHODS = [
  { value: 'Bank', label: 'Bank Transfer' },
  { value: 'Card', label: 'Credit / Debit Card' },
  { value: 'USDT', label: 'USDT Crypto' },
  { value: 'BinancePay', label: 'Binance Pay' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Other', label: 'Other' },
];

export default function Expenses() {
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    const p = {};
    if (category) p.category = category;
    if (search) p.search = search;
    api.get('/expenses', { params: p }).then((r) => setItems(r.data));
  };
  useEffect(() => {
    load();
    api.get('/settings/vendors').then((r) => setVendors(r.data));
  /* eslint-disable-next-line */ }, [category]);

  const openNew = () => {
    setForm(empty);
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({
      expense_date: e.expense_date ? new Date(e.expense_date).toISOString().slice(0, 10) : empty.expense_date,
      vendor_id: e.vendor_id || '',
      vendor_name: e.vendor_name || '',
      category: e.category || 'Other',
      amount: e.amount || '',
      currency: e.currency || 'AED',
      payment_method: e.payment_method || 'Bank',
      bank_name: e.bank_name || '',
      source_wallet: e.source_wallet || '',
      vendor_wallet: e.vendor_wallet || '',
      crypto_network: e.crypto_network || 'TRC20',
      tx_hash: e.tx_hash || e.bank_reference || '',
      notes: e.notes || '',
    });
    setOpen(true);
  };

  const removeExpense = async (e) => {
    if (!window.confirm(`Delete expense ${e.expense_code || e.vendor_name}? This also reverses its wallet ledger entry.`)) return;
    try {
      await api.delete(`/expenses/${e.id}`);
      toast.success('Expense deleted and wallet ledger reversed');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete expense');
    }
  };

  const onVendorChange = (e) => {
    const id = e.target.value;
    const v = vendors.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      vendor_id: id,
      vendor_name: v?.name || '',
      payment_method: v?.default_payment_method || f.payment_method,
      source_wallet: v?.default_wallet || f.source_wallet,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vendor_name?.trim() && !form.vendor_id) {
      toast.error('Pick a vendor first (add one under Settings → Vendors)');
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await api.patch(`/expenses/${editingId}`, form);
        toast.success('Expense updated and wallet ledger refreshed');
      } else {
        await api.post('/expenses', form);
        toast.success('Expense recorded and wallet ledger updated');
      }
      setOpen(false);
      setForm(empty);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed');
    }
    finally { setLoading(false); }
  };

  const method = form.payment_method;
  const isBankLike = method === 'Bank' || method === 'Card';
  const isCryptoLike = method === 'USDT' || method === 'BinancePay';

  return (
    <div>
      <PageHeader
        eyebrow="Spend"
        title="Expenses"
        subtitle="Track operational, vendor and crypto-paid expenses — each entry hits the right wallet ledger automatically."
        actions={<button onClick={openNew} className="btn-primary inline-flex items-center gap-2" data-testid="add-expense-btn"><Plus size={16} /> Add Expense</button>}
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
          <thead><tr><th>Expense</th><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Method</th><th>Wallet / Bank</th><th>TX / Ref</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="9" className="text-center text-gray-500 py-10">No expenses recorded.</td></tr>}
            {items.map((e) => (
              <tr key={e.id} data-testid={`expense-row-${e.id}`}>
                <td className="font-mono text-axistra-green text-sm">{e.expense_code || e.id.slice(0, 8)}</td>
                <td className="text-sm">{fmtDate(e.expense_date)}</td>
                <td className="font-medium">{e.vendor_name}</td>
                <td><span className="badge badge-neutral">{e.category}</span></td>
                <td className="font-mono">{fmtMoney(e.amount, e.currency)}</td>
                <td className="text-xs">{e.payment_method}</td>
                <td className="text-xs">{e.source_wallet || e.bank_name || '—'}</td>
                <td>{e.tx_hash ? <Hash value={e.tx_hash} /> : <span className="text-xs text-gray-500">{e.bank_reference || '—'}</span>}</td>
                <td className="text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      className="rounded-md p-1.5 text-gray-500 hover:text-axistra-green hover:bg-[var(--axistra-green-light)] transition-colors"
                      title="Edit expense"
                      data-testid={`expense-edit-${e.id}`}
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExpense(e)}
                      className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete expense"
                      data-testid={`expense-delete-${e.id}`}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setEditingId(null); }} title={editingId ? 'Edit Expense' : 'Add Expense'} testId="expense-modal" size="lg">
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          {/* Step 1: Payment method FIRST */}
          <Field label="Payment Method *" span={2}>
            <select className="input-axistra" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value, source_wallet: '', bank_name: '' })} data-testid="exp-form-method">
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>

          <Field label="Date *">
            <input type="date" required className="input-axistra" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} data-testid="exp-form-date" />
          </Field>
          <Field label="Category">
            <select className="input-axistra" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="exp-form-category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>

          <Field label="Vendor *" span={2}>
            {vendors.length > 0 ? (
              <select required className="input-axistra" value={form.vendor_id} onChange={onVendorChange} data-testid="exp-form-vendor">
                <option value="">Select a vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.type ? ` — ${v.type}` : ''}</option>)}
              </select>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs flex items-start gap-2">
                <Info size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
                <div>
                  No vendors yet. <a href="/settings" className="underline font-semibold">Add one under Settings → Vendors</a>, then come back to log this expense.
                </div>
              </div>
            )}
          </Field>

          <Field label="Amount *"><input required type="number" step="0.01" className="input-axistra" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="exp-form-amount" /></Field>
          <Field label="Currency">
            <select className="input-axistra" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} data-testid="exp-form-currency">
              <option>AED</option><option>USD</option><option>EUR</option><option>USDT</option>
            </select>
          </Field>

          {/* Conditional — Bank / Card */}
          {isBankLike && (
            <>
              <Field label={`${method === 'Card' ? 'Card issuing' : 'Source'} Bank *`}>
                <select required className="input-axistra" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} data-testid="exp-form-bank">
                  <option value="">Select bank…</option>
                  {BANKS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Bank Reference / Receipt #">
                <input className="input-axistra" value={form.tx_hash} onChange={(e) => setForm({ ...form, tx_hash: e.target.value })} placeholder="Wire reference / receipt #" data-testid="exp-form-bank-ref" />
              </Field>
              <div className="col-span-2 text-xs text-gray-500 -mt-1">
                Wio Bank ledger will be debited automatically by this amount.
              </div>
            </>
          )}

          {/* Conditional — USDT / Binance Pay */}
          {isCryptoLike && (
            <>
              <Field label="Source Wallet *">
                <select required className="input-axistra" value={form.source_wallet} onChange={(e) => setForm({ ...form, source_wallet: e.target.value })} data-testid="exp-form-source-wallet">
                  <option value="">Pick the wallet you paid from…</option>
                  {SOURCE_WALLETS.map((w) => <option key={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Network">
                <select className="input-axistra" value={form.crypto_network} onChange={(e) => setForm({ ...form, crypto_network: e.target.value })}>
                  <option>TRC20</option><option>ERC20</option><option>BEP20</option><option>Polygon</option><option>OFF_CHAIN</option>
                </select>
              </Field>
              <Field label="Vendor Wallet / Pay ID" span={2}>
                <input className="input-axistra font-mono" value={form.vendor_wallet} onChange={(e) => setForm({ ...form, vendor_wallet: e.target.value })} placeholder={method === 'BinancePay' ? 'Binance Pay ID of vendor' : 'Vendor’s receiving wallet address'} data-testid="exp-form-vendor-wallet" />
              </Field>
              <Field label={method === 'BinancePay' ? 'TX ID *' : 'TX Hash *'} span={2}>
                <input required className="input-axistra font-mono" value={form.tx_hash} onChange={(e) => setForm({ ...form, tx_hash: e.target.value })} placeholder={method === 'BinancePay' ? 'Binance internal TX ID' : 'On-chain TX hash'} data-testid="exp-form-tx" />
              </Field>
              <div className="col-span-2 text-xs text-gray-500 -mt-1">
                The selected wallet will be debited by {form.amount || '—'} {form.currency} — a negative ledger entry tagged to this vendor.
              </div>
            </>
          )}

          <Field label="Notes" span={2}>
            <textarea rows={2} className="input-axistra" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => { setOpen(false); setEditingId(null); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="exp-form-submit">{loading ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Expense')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
