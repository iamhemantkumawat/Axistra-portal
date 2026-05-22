import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { PageHeader, Badge, Field, Hash, Modal } from '../components/Atoms';
import AuditChain from '../components/AuditChain';
import { RECHARGE_STATUS_META, fmtMoney, fmtDateTime, downloadBlob } from '../lib/format';
import { API_BASE } from '../lib/api';
import { toast } from 'sonner';
import { Receipt, DownloadSimple, Plug, CurrencyCircleDollar, Bank, Eye } from '@phosphor-icons/react';

export default function RechargeDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [magnusOpen, setMagnusOpen] = useState(false);
  const [magForm, setMagForm] = useState({ magnus_credit_added: '', magnus_reference_id: '' });
  const [treasuryOpen, setTreasuryOpen] = useState(false);
  const [tForm, setTForm] = useState({});
  const [cryptoOpen, setCryptoOpen] = useState(false);
  const [cForm, setCForm] = useState({ crypto_amount: '', tx_hash: '', receiving_wallet: '', aed_rate_at_payment: '', aed_value: '', notes: '' });

  const load = () => api.get(`/recharges/${id}`).then((r) => {
    setData(r.data);
    setTForm(r.data.treasury || {});
    setMagForm({ ...magForm, magnus_credit_added: r.data.magnus_credit_added || r.data.amount });
    setCForm({ ...cForm, crypto_amount: r.data.crypto_amount || r.data.amount, tx_hash: r.data.tx_hash || '' });
  });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!data) return <div className="text-gray-500">Loading…</div>;

  const r = data;
  const statusMeta = RECHARGE_STATUS_META[r.status] || { label: r.status, cls: 'badge-neutral' };

  const updateStatus = async (status, note) => {
    try {
      await api.patch(`/recharges/${id}/status`, { status, note });
      toast.success(`Status updated → ${RECHARGE_STATUS_META[status]?.label}`);
      load();
    } catch (e) { toast.error('Status update failed'); }
  };

  const submitMagnus = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/recharges/${id}/sync-magnus`, magForm);
      toast.success('Magnus credit recorded');
      setMagnusOpen(false); load();
    } catch (err) { toast.error('Magnus sync failed'); }
  };

  const submitTreasury = async (e) => {
    e.preventDefault();
    try {
      const body = { ...tForm };
      // Auto-compute AED if both fields present
      if (body.usdt_converted && body.okx_conversion_rate && !body.aed_received) {
        body.aed_received = (parseFloat(body.usdt_converted) * parseFloat(body.okx_conversion_rate)).toFixed(2);
      }
      await api.post(`/treasury/movement/${id}`, body);
      toast.success('Treasury movement updated');
      setTreasuryOpen(false); load();
    } catch (err) { toast.error('Update failed'); }
  };

  const submitCrypto = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/recharges/${id}/crypto-tx`, cForm);
      toast.success('Crypto TX recorded');
      setCryptoOpen(false); load();
    } catch (err) { toast.error('Failed'); }
  };

  const downloadInvoice = () => {
    if (!r.invoice_id) return;
    downloadBlob(`${API_BASE}/invoices/${r.invoice_id}/pdf`, `${r.invoice_number}.pdf`);
  };

  const viewInvoice = async () => {
    if (!r.invoice_id) return;
    const token = localStorage.getItem('axistra_token');
    const res = await fetch(`${API_BASE}/invoices/${r.invoice_id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <PageHeader
        eyebrow={r.recharge_code}
        title={`${fmtMoney(r.amount, r.currency)} payment`}
        subtitle={`${r.customer?.full_name || '—'} · ${r.customer?.customer_code || ''}`}
        actions={
          <>
            <Link to="/recharges" className="btn-secondary">← Back</Link>
            {r.invoice_id && (
              <>
                <button onClick={viewInvoice} className="btn-secondary inline-flex items-center gap-2" data-testid="view-invoice-btn">
                  <Eye size={16} /> View Invoice
                </button>
                <button onClick={downloadInvoice} className="btn-secondary inline-flex items-center gap-2" data-testid="download-invoice-btn">
                  <DownloadSimple size={16} /> Download PDF
                </button>
              </>
            )}
          </>
        }
      />

      <div className="mb-6">
        <AuditChain recharge={r} treasury={r.treasury} invoice={r.invoice} crypto={r.crypto_transactions} />
      </div>

      {r.status === 'mismatch' && (
        <div className="mb-6 p-4 border border-red-300 bg-red-50 text-red-800 rounded-md text-sm" data-testid="mismatch-warning">
          <strong>Reconciliation mismatch detected.</strong> {r.reconciliation_note}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Payment details */}
        <div className="card-axistra p-6 lg:col-span-2">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-display text-lg font-semibold">Payment Details</h3>
            <Badge className={statusMeta.cls}>{statusMeta.label}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><div className="label-xs mb-1">Amount</div><div className="font-mono font-semibold">{fmtMoney(r.amount, r.currency)}</div></div>
            <div><div className="label-xs mb-1">Crypto</div><div className="font-mono">{r.crypto_amount} {r.crypto_coin} / {r.crypto_network}</div></div>
            <div><div className="label-xs mb-1">Gateway</div><div>{r.payment_gateway}</div></div>
            <div><div className="label-xs mb-1">Payment Date</div><div>{fmtDateTime(r.payment_date)}</div></div>
            <div className="col-span-2"><div className="label-xs mb-1">Wallet Address</div><Hash value={r.wallet_address} testId="rdetail-wallet" /></div>
            <div className="col-span-2"><div className="label-xs mb-1">TX Hash</div><Hash value={r.tx_hash} testId="rdetail-tx" /></div>
            <div><div className="label-xs mb-1">Invoice</div><div className="font-mono text-axistra-green">{r.invoice_number || '—'}</div></div>
            <div><div className="label-xs mb-1">Magnus Username</div><div className="font-mono">{r.magnus_username || '—'}</div></div>
            <div><div className="label-xs mb-1">Magnus Credit Added</div><div className="font-mono">{r.magnus_credit_added ? fmtMoney(r.magnus_credit_added, r.currency) : '—'}</div></div>
            <div><div className="label-xs mb-1">Magnus Reference</div><div className="font-mono">{r.magnus_reference_id || '—'}</div></div>
            {r.admin_notes && <div className="col-span-2"><div className="label-xs mb-1">Admin Notes</div><div className="text-gray-700">{r.admin_notes}</div></div>}
          </div>
        </div>

        {/* Treasury card */}
        <div className="card-axistra p-6">
          <div className="flex justify-between mb-4">
            <h3 className="font-display text-lg font-semibold">Treasury Flow</h3>
            <button onClick={() => setTreasuryOpen(true)} className="text-xs text-axistra-green hover:underline" data-testid="edit-treasury-btn">Update →</button>
          </div>
          {r.treasury ? (
            <div className="space-y-3 text-sm">
              <Row label="USDT Received" value={r.treasury.total_usdt_received || '0'} mono />
              <Row label="Sent to OKX" value={r.treasury.transferred_to_okx ? '✓ Yes' : 'Pending'} />
              <Row label="OKX TX" value={<Hash value={r.treasury.okx_deposit_tx_hash} />} />
              <Row label="USDT Converted" value={r.treasury.usdt_converted || '0'} mono />
              <Row label="OKX Rate" value={r.treasury.okx_conversion_rate || '—'} mono />
              <Row label="AED Received" value={r.treasury.aed_received ? `${parseFloat(r.treasury.aed_received).toLocaleString()} AED` : '—'} mono accent />
              <Row label="Wio Reference" value={r.treasury.wio_bank_reference || '—'} mono />
              <Row label="Wio Deposit" value={r.treasury.transferred_to_wio ? '✓ Done' : 'Pending'} />
            </div>
          ) : (
            <div className="text-sm text-gray-500">No treasury movement yet.</div>
          )}
        </div>
      </div>

      {/* Action panel */}
      <div className="card-axistra p-6 mt-6" data-testid="recharge-actions">
        <h3 className="font-display text-lg font-semibold mb-4">Chain Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <button onClick={() => setCryptoOpen(true)} className="btn-secondary inline-flex items-center justify-center gap-2" data-testid="action-record-crypto"><Receipt size={16} /> Record Crypto TX</button>
          <button onClick={() => setMagnusOpen(true)} className="btn-secondary inline-flex items-center justify-center gap-2" data-testid="action-magnus-credit"><Plug size={16} /> Add Magnus Credit</button>
          <button onClick={() => setTreasuryOpen(true)} className="btn-secondary inline-flex items-center justify-center gap-2" data-testid="action-okx-wio"><Bank size={16} /> OKX / Wio Step</button>
          <button onClick={() => updateStatus('refunded', 'Manually refunded')} className="btn-secondary inline-flex items-center justify-center gap-2 text-red-700" data-testid="action-refund"><CurrencyCircleDollar size={16} /> Mark Refunded</button>
        </div>
        <div className="mt-4 text-xs text-gray-500">Status flow advances automatically based on chain actions. Use <em>Mark Refunded</em> for explicit refunds.</div>
      </div>

      {/* Crypto modal */}
      <Modal open={cryptoOpen} onClose={() => setCryptoOpen(false)} title="Record Crypto Transaction" testId="crypto-modal">
        <form onSubmit={submitCrypto} className="grid grid-cols-2 gap-4">
          <Field label="Crypto Amount"><input className="input-axistra" value={cForm.crypto_amount} onChange={(e) => setCForm({ ...cForm, crypto_amount: e.target.value })} data-testid="crypto-form-amount" /></Field>
          <Field label="Coin"><input className="input-axistra" value={cForm.coin || r.crypto_coin} onChange={(e) => setCForm({ ...cForm, coin: e.target.value })} data-testid="crypto-form-coin" /></Field>
          <Field label="Receiving Wallet" span={2}><input className="input-axistra font-mono" value={cForm.receiving_wallet} onChange={(e) => setCForm({ ...cForm, receiving_wallet: e.target.value })} data-testid="crypto-form-wallet" /></Field>
          <Field label="TX Hash" span={2}><input required className="input-axistra font-mono" value={cForm.tx_hash} onChange={(e) => setCForm({ ...cForm, tx_hash: e.target.value })} data-testid="crypto-form-tx" /></Field>
          <Field label="AED Rate at Payment"><input className="input-axistra" value={cForm.aed_rate_at_payment} onChange={(e) => setCForm({ ...cForm, aed_rate_at_payment: e.target.value })} data-testid="crypto-form-rate" /></Field>
          <Field label="AED Value"><input className="input-axistra" value={cForm.aed_value} onChange={(e) => setCForm({ ...cForm, aed_value: e.target.value })} data-testid="crypto-form-aed" /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={cForm.notes} onChange={(e) => setCForm({ ...cForm, notes: e.target.value })} /></Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setCryptoOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="crypto-form-submit">Record TX</button>
          </div>
        </form>
      </Modal>

      {/* Magnus modal */}
      <Modal open={magnusOpen} onClose={() => setMagnusOpen(false)} title="Add Magnus Credit (Manual)" testId="magnus-modal">
        <form onSubmit={submitMagnus} className="space-y-4">
          <Field label="Credit Amount"><input className="input-axistra" value={magForm.magnus_credit_added} onChange={(e) => setMagForm({ ...magForm, magnus_credit_added: e.target.value })} data-testid="magnus-form-amount" /></Field>
          <Field label="Magnus Reference ID"><input className="input-axistra font-mono" value={magForm.magnus_reference_id} onChange={(e) => setMagForm({ ...magForm, magnus_reference_id: e.target.value })} data-testid="magnus-form-ref" placeholder="auto-generated if left blank" /></Field>
          <div className="text-xs text-gray-500">Validation: this amount is matched against invoice {r.invoice_number} = {fmtMoney(r.amount, r.currency)}. A mismatch raises a reconciliation warning.</div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMagnusOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="magnus-form-submit">Save Credit</button>
          </div>
        </form>
      </Modal>

      {/* Treasury modal */}
      <Modal open={treasuryOpen} onClose={() => setTreasuryOpen(false)} title="Treasury Movement (OKX → Wio)" testId="treasury-modal">
        <form onSubmit={submitTreasury} className="grid grid-cols-2 gap-4">
          <Field label="USDT Received"><input className="input-axistra" value={tForm.total_usdt_received || ''} onChange={(e) => setTForm({ ...tForm, total_usdt_received: e.target.value })} data-testid="treasury-form-usdt" /></Field>
          <Field label="Receiving Wallet"><input className="input-axistra font-mono" value={tForm.receiving_wallet || ''} onChange={(e) => setTForm({ ...tForm, receiving_wallet: e.target.value })} /></Field>

          <Field label="Transferred to OKX">
            <select className="input-axistra" value={tForm.transferred_to_okx ? 'yes' : 'no'} onChange={(e) => setTForm({ ...tForm, transferred_to_okx: e.target.value === 'yes' })}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="OKX Deposit TX Hash"><input className="input-axistra font-mono" value={tForm.okx_deposit_tx_hash || ''} onChange={(e) => setTForm({ ...tForm, okx_deposit_tx_hash: e.target.value })} /></Field>

          <Field label="USDT Converted"><input className="input-axistra" value={tForm.usdt_converted || ''} onChange={(e) => setTForm({ ...tForm, usdt_converted: e.target.value })} data-testid="treasury-form-usdt-converted" /></Field>
          <Field label="OKX Conversion Rate"><input className="input-axistra" value={tForm.okx_conversion_rate || ''} onChange={(e) => setTForm({ ...tForm, okx_conversion_rate: e.target.value })} data-testid="treasury-form-rate" placeholder="e.g. 3.67" /></Field>
          <Field label="AED Received"><input className="input-axistra" value={tForm.aed_received || ''} onChange={(e) => setTForm({ ...tForm, aed_received: e.target.value })} data-testid="treasury-form-aed" /></Field>
          <Field label="Converted to AED">
            <select className="input-axistra" value={tForm.converted_to_aed ? 'yes' : 'no'} onChange={(e) => setTForm({ ...tForm, converted_to_aed: e.target.value === 'yes' })} data-testid="treasury-form-converted">
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>

          <Field label="Wio Bank Reference"><input className="input-axistra font-mono" value={tForm.wio_bank_reference || ''} onChange={(e) => setTForm({ ...tForm, wio_bank_reference: e.target.value })} data-testid="treasury-form-wio-ref" /></Field>
          <Field label="Transferred to Wio">
            <select className="input-axistra" value={tForm.transferred_to_wio ? 'yes' : 'no'} onChange={(e) => setTForm({ ...tForm, transferred_to_wio: e.target.value === 'yes' })} data-testid="treasury-form-wio">
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Wio AED Amount"><input className="input-axistra" value={tForm.wio_aed_amount || ''} onChange={(e) => setTForm({ ...tForm, wio_aed_amount: e.target.value })} /></Field>
          <Field label="Wio Deposit Date"><input type="date" className="input-axistra" value={tForm.wio_deposit_date ? String(tForm.wio_deposit_date).slice(0, 10) : ''} onChange={(e) => setTForm({ ...tForm, wio_deposit_date: e.target.value })} /></Field>

          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={tForm.notes || ''} onChange={(e) => setTForm({ ...tForm, notes: e.target.value })} /></Field>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setTreasuryOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" data-testid="treasury-form-submit">Save Movement</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const Row = ({ label, value, mono, accent }) => (
  <div className="flex justify-between gap-3 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
    <span className="text-gray-500 text-xs uppercase tracking-wider">{label}</span>
    <span className={`${mono ? 'font-mono' : ''} ${accent ? 'text-axistra-green font-semibold' : 'text-gray-900'} text-sm text-right`}>{value}</span>
  </div>
);
