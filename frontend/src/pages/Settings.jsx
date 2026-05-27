import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Modal, Field } from '../components/Atoms';
import { useCurrency } from '../lib/currency';
import { Plus, Pencil, Trash, Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';

const COMPANY = {
  name: 'AXISTRA TECHNOLOGIES - FZCO',
  tagline: 'Innovate • Connect • Grow',
  trn: '105415374500001',
  giban: 'AE037350105415374500001',
  license: '86256',
  registrationNo: '79504',
  address: 'IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai, UAE',
  authority: 'Dubai Silicon Oasis / IFZA',
  legalStructure: 'FZCO (Free Zone Company)',
  shareCapital: 'AED 100,000 divided into 100 shares',
  service: 'SaaS Platform Usage Credits',
};

const GATEWAYS = ['Binance', 'OKX', 'OxaPay', 'BTCPay'];
const COINS = ['BTC', 'USDT', 'ETH', 'USDC', 'BNB', 'TRX'];
const NETWORKS = ['BTC', 'TRC20', 'ERC20', 'BEP20', 'Polygon', 'Solana', 'OFF_CHAIN'];
const WALLET_CODES = ['BINANCE', 'OKX', 'OXAPAY', 'BTCPAY', 'WIO_BANK'];
const PAYMENT_METHODS = ['Bank', 'Card', 'USDT', 'BinancePay', 'Cash', 'Other'];

export default function Settings() {
  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="Company identity, receiving wallets, vendors and audit-chain configuration."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CompanyCard />
        <ComplianceCard />
        <ReceivingWalletsCard />
        <VendorsCard />
        <AuditChainCard />
      </div>
    </div>
  );
}

/* ---------------- Sub-cards ---------------- */

const CompanyCard = () => (
  <div className="card-axistra p-6">
    <h3 className="font-display text-lg font-semibold mb-4">Company Identity</h3>
    <div className="space-y-3 text-sm">
      <Row label="Legal Entity" value={COMPANY.name} />
      <Row label="Brand Line" value={COMPANY.tagline} />
      <Row label="Trade License" value={COMPANY.license} mono />
      <Row label="Registration No" value={COMPANY.registrationNo} mono />
      <Row label="Corporate TRN" value={COMPANY.trn} mono />
      <Row label="GIBAN" value={COMPANY.giban} mono />
      <Row label="Address" value={COMPANY.address} />
      <Row label="Authority" value={COMPANY.authority} />
      <Row label="Legal Structure" value={COMPANY.legalStructure} />
      <Row label="Share Capital" value={COMPANY.shareCapital} />
      <Row label="Primary Service" value={COMPANY.service} />
    </div>
  </div>
);

const ComplianceCard = () => {
  const { rates, meta } = useCurrency();
  return (
    <div className="card-axistra p-6">
      <h3 className="font-display text-lg font-semibold mb-4">Compliance Constants</h3>
      <div className="space-y-3 text-sm">
        <Row label="UAE VAT Threshold" value="AED 375,000" />
        <Row label="Corporate Tax Threshold" value="AED 375,000" />
        <Row label="Corporate Tax Rate" value="9%" />
        <Row label="AED / AED" value="1.0000" mono />
        <Row label="USD / AED (Peg)" value="3.6725" mono />
        <Row label="EUR / AED (Daily)" value={Number(rates.EUR || 0).toFixed(4)} mono />
        <Row label="INR / AED (Daily)" value={Number(rates.INR || 0).toFixed(4)} mono />
        <Row label="FX Source" value={meta.reference_date ? `ECB ${meta.reference_date}` : 'Fallback cache'} />
      </div>
      <p className="text-xs text-gray-500 mt-4 leading-relaxed">
        AED stays fixed, USD stays pegged at 3.6725, and EUR / INR are refreshed from the ECB daily reference feed.
      </p>
    </div>
  );
};

const AuditChainCard = () => (
  <div className="card-axistra p-6 lg:col-span-2">
    <h3 className="font-display text-lg font-semibold mb-4">Audit Chain</h3>
    <p className="text-sm text-gray-600 mb-4">Every payment is verified through this fixed six-step chain. Each step is gated and logged.</p>
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center text-xs">
      {['Customer', 'Invoice', 'Crypto TX', 'Magnus Credit', 'OKX Conversion', 'Wio Bank Deposit'].map((s, i) => (
        <div key={s} className="p-3 rounded-md border border-gray-200 bg-gradient-to-b from-white to-[var(--axistra-green-light)]">
          <div className="text-axistra-green font-bold mb-1">{i + 1}</div>
          <div className="font-semibold text-gray-800">{s}</div>
        </div>
      ))}
    </div>
  </div>
);

/* ---------------- Receiving Wallets ---------------- */

const emptyWallet = { gateway: 'Binance', coin: 'BTC', network: 'BTC', address: '', label: '', notes: '', is_active: true };

function ReceivingWalletsCard() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyWallet);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.get('/settings/receiving-wallets').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); setForm(emptyWallet); setOpen(true); };
  const onEdit = (row) => {
    setEditing(row.id);
    setForm({
      gateway: row.gateway,
      coin: row.coin,
      network: row.network,
      address: row.address,
      label: row.label || '',
      notes: row.notes || '',
      is_active: row.is_active,
    });
    setOpen(true);
  };
  const onDelete = async (row) => {
    if (!window.confirm(`Delete ${row.gateway} ${row.coin}/${row.network} address?`)) return;
    await api.delete(`/settings/receiving-wallets/${row.id}`);
    toast.success('Wallet removed');
    load();
  };
  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.patch(`/settings/receiving-wallets/${editing}`, form);
        toast.success('Wallet updated');
      } else {
        await api.post('/settings/receiving-wallets', form);
        toast.success('Wallet added');
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };
  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('Address copied'); };

  return (
    <div className="card-axistra p-6 lg:col-span-2" data-testid="receiving-wallets-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display text-lg font-semibold">Receiving Wallets</h3>
          <p className="text-xs text-gray-500 mt-1">When a recharge wallet address matches one here, the payment gateway auto-resolves — no more “mismatch”.</p>
        </div>
        <button onClick={onAdd} className="btn-primary inline-flex items-center gap-2" data-testid="add-wallet-btn">
          <Plus size={16} /> Add Wallet
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Gateway</th><th>Coin / Network</th><th>Label</th><th>Address</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="text-center text-gray-500 py-8">No receiving wallets saved yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid={`wallet-row-${r.gateway}-${r.coin}`}>
                <td><span className="badge badge-neutral">{r.gateway}</span></td>
                <td className="font-mono text-sm">{r.coin} · {r.network}</td>
                <td className="text-sm">{r.label || '—'}</td>
                <td>
                  <button onClick={() => copy(r.address)} className="hash-pill hover:bg-gray-200 inline-flex items-center gap-1.5" title="Copy">
                    <span className="font-mono text-xs">{r.address.length > 22 ? `${r.address.slice(0,10)}…${r.address.slice(-8)}` : r.address}</span>
                    <Copy size={11} />
                  </button>
                </td>
                <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-neutral'}`}>{r.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="text-right">
                  <button onClick={() => onEdit(r)} className="text-gray-500 hover:text-axistra-green p-1" title="Edit" data-testid={`wallet-edit-${r.gateway}-${r.coin}`}><Pencil size={14} /></button>
                  <button onClick={() => onDelete(r)} className="text-gray-500 hover:text-red-600 p-1 ml-1" title="Delete" data-testid={`wallet-delete-${r.gateway}-${r.coin}`}><Trash size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Receiving Wallet' : 'Add Receiving Wallet'} testId="wallet-modal">
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
          <Field label="Gateway *">
            <select required value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })} className="input-axistra" data-testid="wallet-form-gateway">
              {GATEWAYS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Coin *">
            <select required value={form.coin} onChange={(e) => setForm({ ...form, coin: e.target.value })} className="input-axistra" data-testid="wallet-form-coin">
              {COINS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Network *">
            <select required value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} className="input-axistra" data-testid="wallet-form-network">
              {NETWORKS.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Label">
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Binance Main BTC" className="input-axistra" data-testid="wallet-form-label" />
          </Field>
          <Field label="Address *" span={2}>
            <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-axistra font-mono text-sm" data-testid="wallet-form-address" />
          </Field>
          <Field label="Notes" span={2}>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-axistra" />
          </Field>
          <Field label="Status">
            <select value={form.is_active ? 'active' : 'disabled'} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })} className="input-axistra">
              <option value="active">Active</option><option value="disabled">Disabled</option>
            </select>
          </Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="wallet-form-submit">{loading ? 'Saving…' : editing ? 'Save Changes' : 'Add Wallet'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ---------------- Vendors ---------------- */

const emptyVendor = { name: '', type: '', contact: '', default_wallet: '', default_payment_method: '', notes: '', is_active: true };
const VENDOR_TYPES = ['SaaS', 'Telecom', 'VPS / Hosting', 'Office', 'Legal', 'Bank', 'Marketing', 'Other'];

function VendorsCard() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyVendor);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.get('/settings/vendors').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const onAdd = () => { setEditing(null); setForm(emptyVendor); setOpen(true); };
  const onEdit = (row) => {
    setEditing(row.id);
    setForm({
      name: row.name,
      type: row.type || '',
      contact: row.contact || '',
      default_wallet: row.default_wallet || '',
      default_payment_method: row.default_payment_method || '',
      notes: row.notes || '',
      is_active: row.is_active,
    });
    setOpen(true);
  };
  const onDelete = async (row) => {
    if (!window.confirm(`Delete vendor "${row.name}"?`)) return;
    await api.delete(`/settings/vendors/${row.id}`);
    toast.success('Vendor removed');
    load();
  };
  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.patch(`/settings/vendors/${editing}`, form);
        toast.success('Vendor updated');
      } else {
        await api.post('/settings/vendors', form);
        toast.success('Vendor added');
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-axistra p-6 lg:col-span-2" data-testid="vendors-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display text-lg font-semibold">Vendors</h3>
          <p className="text-xs text-gray-500 mt-1">Reusable payee directory for expenses — used by the Expenses form.</p>
        </div>
        <button onClick={onAdd} className="btn-primary inline-flex items-center gap-2" data-testid="add-vendor-btn">
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-axistra">
          <thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Default Method</th><th>Default Wallet</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="text-center text-gray-500 py-8">No vendors yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid={`vendor-row-${r.name}`}>
                <td className="font-medium">{r.name}</td>
                <td className="text-sm">{r.type || '—'}</td>
                <td className="text-sm font-mono text-xs">{r.contact || '—'}</td>
                <td className="text-sm">{r.default_payment_method || '—'}</td>
                <td className="text-sm">{r.default_wallet || '—'}</td>
                <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-neutral'}`}>{r.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="text-right">
                  <button onClick={() => onEdit(r)} className="text-gray-500 hover:text-axistra-green p-1" title="Edit" data-testid={`vendor-edit-${r.name}`}><Pencil size={14} /></button>
                  <button onClick={() => onDelete(r)} className="text-gray-500 hover:text-red-600 p-1 ml-1" title="Delete" data-testid={`vendor-delete-${r.name}`}><Trash size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Vendor' : 'Add Vendor'} testId="vendor-modal">
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
          <Field label="Name *" span={2}>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-axistra" data-testid="vendor-form-name" />
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-axistra">
              <option value="">—</option>
              {VENDOR_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Contact">
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="email / phone / URL" className="input-axistra" />
          </Field>
          <Field label="Default Payment Method">
            <select value={form.default_payment_method} onChange={(e) => setForm({ ...form, default_payment_method: e.target.value })} className="input-axistra">
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Default Source Wallet">
            <select value={form.default_wallet} onChange={(e) => setForm({ ...form, default_wallet: e.target.value })} className="input-axistra">
              <option value="">—</option>
              {WALLET_CODES.map((w) => <option key={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Notes" span={2}>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-axistra" />
          </Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" data-testid="vendor-form-submit">{loading ? 'Saving…' : editing ? 'Save Changes' : 'Add Vendor'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const Row = ({ label, value, mono }) => (
  <div className="flex justify-between gap-3 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
    <span className="text-gray-500 uppercase text-xs tracking-wider">{label}</span>
    <span className={`text-gray-900 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);
