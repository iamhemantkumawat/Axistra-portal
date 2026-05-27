export const fmtMoney = (v, currency = 'USD') => {
  const n = parseFloat(v || 0);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtNumber = (v) => parseFloat(v || 0).toLocaleString();

export const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const shortenHash = (h, n = 8) => (!h ? '—' : h.length <= n * 2 + 3 ? h : `${h.slice(0, n)}…${h.slice(-n)}`);

export const RECHARGE_STATUS_META = {
  pending_payment: { label: 'Pending Payment', cls: 'badge-warning' },
  payment_received: { label: 'Payment Received', cls: 'badge-info' },
  magnus_credited: { label: 'Magnus Credited', cls: 'badge-info' },
  sent_to_okx: { label: 'Sent to Exchange', cls: 'badge-info' },
  converted_to_aed: { label: 'Converted to AED', cls: 'badge-info' },
  deposited_to_wio: { label: 'Deposited to Wio', cls: 'badge-info' },
  fully_reconciled: { label: 'Fully Reconciled', cls: 'badge-success' },
  mismatch: { label: 'Mismatch', cls: 'badge-error' },
  refunded: { label: 'Refunded', cls: 'badge-neutral' },
  failed: { label: 'Failed', cls: 'badge-error' },
};

export const RISK_META = {
  Low: { cls: 'badge-success' },
  Medium: { cls: 'badge-warning' },
  High: { cls: 'badge-error' },
};

export const KYC_META = {
  not_required: { label: 'Not Required', cls: 'badge-neutral' },
  requested: { label: 'Requested', cls: 'badge-warning' },
  submitted: { label: 'Submitted', cls: 'badge-info' },
  approved: { label: 'Approved', cls: 'badge-success' },
  rejected: { label: 'Rejected', cls: 'badge-error' },
};

export const CUSTOMER_STATUS_META = {
  pending: { label: 'Pending', cls: 'badge-warning' },
  active: { label: 'Active', cls: 'badge-success' },
  suspended: { label: 'Suspended', cls: 'badge-warning' },
  blocked: { label: 'Blocked', cls: 'badge-error' },
};

export const downloadBlob = async (url, filename) => {
  const token = localStorage.getItem('axistra_token');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};
