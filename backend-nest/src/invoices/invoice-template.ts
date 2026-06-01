import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Invoice } from '../entities/invoice.entity';

type InvoiceView = Invoice & {
  customer_phone?: string;
  customer_address?: string;
  payment_transactions?: Array<{
    tx_hash?: string;
    coin?: string;
    network?: string;
    crypto_amount?: string;
    sent_amount?: string;
    received_amount?: string;
    final_usdt_amount?: string;
    sender_address?: string;
    receiving_wallet?: string;
    gateway_tx_status?: string;
    confirmations?: string;
  }>;
};

const COMPANY = {
  name: 'AXISTRA TECHNOLOGIES - FZCO',
  tagline: 'Innovate • Connect • Grow',
  trn: '105415374500001',
  license: '86256',
  registrationNo: '79504',
  addressLines: [
    'IFZA Business Park, DDP',
    'Dubai Silicon Oasis',
    'Dubai, United Arab Emirates',
  ],
  authority: 'Dubai Silicon Oasis / IFZA',
  website: 'www.axistratech.com',
  email: 'info@axistratech.com',
  phone: '+971 55 517 8244',
  service: 'SaaS Platform Usage Credits',
  description: 'Prepaid credits for usage of Axistra cloud software platform and related digital services.',
};

const ICONS = {
  location: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11Zm0-8.2a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  email: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m5 7 7 6 7-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  web: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3c2.7 2.5 4.2 5.8 4.2 9S14.7 18.5 12 21c-2.7-2.5-4.2-5.8-4.2-9S9.3 5.5 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 4.5h3.4l1.7 4.3-2 1.7a15.2 15.2 0 0 0 4.9 4.9l1.7-2 4.3 1.7v3.4c0 .8-.7 1.5-1.5 1.5A15.5 15.5 0 0 1 4 6c0-.8.7-1.5 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const ASSET_DIR = join(process.cwd(), 'assets');
const assetCache = new Map<string, string>();
const pdfCache = new Map<string, Buffer>();
let browserPromise: Promise<any> | null = null;

function formatDate(value?: Date | string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function iconLabel(icon: string, value: string, extraClass = '') {
  return `<div class="icon-line ${extraClass}"><span class="icon">${icon}</span><span>${value}</span></div>`;
}

function getAssetDataUri(fileName: string) {
  if (assetCache.has(fileName)) return assetCache.get(fileName);
  const fullPath = join(ASSET_DIR, fileName);
  if (!existsSync(fullPath)) return null;
  const ext = fileName.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  const encoded = readFileSync(fullPath).toString('base64');
  const uri = `data:image/${ext};base64,${encoded}`;
  assetCache.set(fileName, uri);
  return uri;
}

function invoiceCacheKey(inv: InvoiceView) {
  return JSON.stringify({
    invoice_number: inv.invoice_number,
    status: inv.status,
    amount: inv.amount,
    currency: inv.currency,
    tx_hash: inv.tx_hash,
    payment_method: inv.payment_method,
    crypto_coin: inv.crypto_coin,
    crypto_network: inv.crypto_network,
    issued_date: inv.issued_date,
    customer_name: inv.customer_name,
    customer_email: inv.customer_email,
    customer_country: inv.customer_country,
    customer_company: inv.customer_company,
    customer_phone: inv.customer_phone,
    customer_address: inv.customer_address,
    payment_transactions: inv.payment_transactions,
    service_name: inv.service_name,
    service_description: inv.service_description,
  });
}

async function getBrowser() {
  if (!browserPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer');
    browserPromise = puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

export function renderInvoiceHtml(inv: InvoiceView): string {
  const issuedDate = inv.issued_date ? new Date(inv.issued_date) : new Date(inv.created_at);
  const dueDate = new Date(issuedDate);
  dueDate.setDate(dueDate.getDate() + 7);
  const amount = parseFloat(inv.amount || '0').toFixed(2);
  const logo = getAssetDataUri('axistra-invoice-logo.png');
  const stamp = getAssetDataUri('digital-stamp.png');
  const serviceName = escapeHtml(inv.service_name || COMPANY.service);
  const serviceDescription = escapeHtml(inv.service_description || COMPANY.description);
  const customerName = escapeHtml(inv.customer_name || 'Customer');
  const customerCompany = escapeHtml(inv.customer_company || '');
  const customerEmail = escapeHtml(inv.customer_email || '');
  const customerCountry = escapeHtml(inv.customer_country || '');
  const customerPhone = escapeHtml(inv.customer_phone || '');
  const customerAddressLines = String(inv.customer_address || '')
    .split(/\r?\n|,/)
    .map((line) => escapeHtml(line).trim())
    .filter(Boolean);
  const txHash = escapeHtml(inv.tx_hash || '');
  const paymentMethod = escapeHtml(inv.payment_method || '');
  const coin = escapeHtml(inv.crypto_coin || '');
  const network = escapeHtml(inv.crypto_network || '');
  const currency = escapeHtml(inv.currency || 'USD');
  const invoiceNumber = escapeHtml(inv.invoice_number);
  const status = escapeHtml((inv.status || 'unpaid').toUpperCase());
  const paymentTransactions = Array.isArray(inv.payment_transactions) ? inv.payment_transactions : [];
  const gatewayRows = paymentTransactions.map((tx, index) => {
    const coinLabel = [tx.crypto_amount || tx.received_amount || tx.sent_amount, tx.coin, tx.network].filter(Boolean).join(' ');
    const usdtLabel = tx.final_usdt_amount ? `${escapeHtml(tx.final_usdt_amount)} USDT` : '';
    return `
      <div class="tx-row">
        <div class="tx-main">
          <strong>${index + 1}. ${escapeHtml(coinLabel || 'Crypto payment')}</strong>
          ${usdtLabel ? `<span>${usdtLabel}</span>` : ''}
        </div>
        ${tx.sender_address ? `<div class="tx-muted">From ${escapeHtml(tx.sender_address)}</div>` : ''}
        ${tx.receiving_wallet ? `<div class="tx-muted">To ${escapeHtml(tx.receiving_wallet)}</div>` : ''}
        ${tx.tx_hash ? `<div class="tx-hash">${escapeHtml(tx.tx_hash)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${invoiceNumber}</title>
  <style>
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; }
    :root {
      --brand-green: #0A5C3E;
      --brand-gold: #D4AF37;
      --text-main: #163129;
      --text-soft: #36534a;
      --border-soft: rgba(18,49,41,0.12);
      --body-font: "Helvetica Neue", Arial, "Segoe UI", sans-serif;
      --heading-font: "Helvetica Neue", Arial, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      font-family: var(--body-font);
      color: var(--text-main);
      background: #eef2ef;
    }
    .page {
      position: relative;
      width: 210mm;
      height: 297mm;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(circle at top left, rgba(212, 175, 55, 0.12), transparent 28%),
        radial-gradient(circle at bottom right, rgba(10, 92, 62, 0.12), transparent 24%),
        #ffffff;
      overflow: hidden;
    }
    .content {
      position: relative;
      padding: 12mm 12mm 8mm;
      z-index: 2;
      flex: 1 1 auto;
    }
    .header {
      display: grid;
      grid-template-columns: 1.1fr 1px 0.86fr;
      align-items: start;
      gap: 9mm;
      padding-bottom: 7mm;
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 6mm;
    }
    .brand-wrap img {
      width: 86mm;
      max-width: 100%;
      display: block;
    }
    .header-divider {
      width: 1px;
      height: 26mm;
      background: rgba(22,49,41,0.22);
      justify-self: center;
      margin-top: 2mm;
    }
    .company-card h2 {
      margin: 0 0 2.2mm;
      font-family: var(--heading-font);
      color: var(--brand-green);
      font-size: 4.5mm;
      line-height: 1.05;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .company-card p,
    .company-card .legal {
      margin: 0 0 0.85mm;
      color: #101010;
      font-size: 2.75mm;
      line-height: 1.28;
    }
    .company-card .legal {
      display: inline-block;
      margin: 1.2mm 2.3mm 0 0;
      color: #345148;
      font-size: 2.55mm;
      font-weight: 600;
      line-height: 1.25;
      white-space: nowrap;
    }
    .icon-line {
      display: grid;
      grid-template-columns: 3.8mm 1fr;
      gap: 2mm;
      align-items: start;
      margin: 0 0 0.85mm;
      color: #101010;
      font-size: 2.85mm;
      line-height: 1.28;
    }
    .icon-line .icon {
      width: 3.7mm;
      height: 3.7mm;
      color: #161616;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transform: translateY(0.1mm);
    }
    .icon-line .icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .section-rule {
      height: 0.45mm;
      background: linear-gradient(90deg, rgba(212,175,55,0.25), rgba(212,175,55,0.94), rgba(212,175,55,0.25));
      margin: 0 0 7mm;
    }
    .hero {
      display: grid;
      grid-template-columns: 1fr 0.95fr;
      gap: 12mm;
      align-items: start;
      margin-bottom: 6mm;
    }
    .eyebrow {
      color: var(--brand-gold);
      font-family: var(--heading-font);
      font-size: 3.3mm;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 1.6mm;
    }
    .bill-card h3 {
      margin: 0 0 1.8mm;
      font-family: var(--heading-font);
      color: var(--brand-green);
      font-size: 5.4mm;
      line-height: 1.12;
    }
    .bill-card {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 0;
    }
    .bill-card p,
    .bill-card .icon-line {
      margin: 0 0 0.9mm;
      color: #111111;
      font-size: 3.35mm;
      line-height: 1.32;
    }
    .invoice-card {
      padding: 0;
      border-radius: 0;
      background: transparent;
      border: none;
      box-shadow: none;
    }
    .invoice-title {
      margin: 0;
      font-family: var(--heading-font);
      color: #0A5C3E;
      font-size: 10.4mm;
      line-height: 0.92;
      font-weight: 800;
      letter-spacing: 0.01em;
    }
    .invoice-number {
      margin-top: 1.8mm;
      color: var(--brand-gold);
      font-family: var(--heading-font);
      font-size: 4.7mm;
      font-weight: 700;
    }
    .meta-grid {
      margin-top: 4.2mm;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1.4mm 5mm;
      font-size: 3.1mm;
      color: #222222;
    }
    .meta-grid .label {
      color: #111111;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status-badge {
      display: inline-flex;
      padding: 1mm 2.8mm;
      border-radius: 999px;
      background: #FFF4D6;
      color: #9A6B00;
      font-size: 2.7mm;
      font-weight: 800;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin-top: 4mm;
      border: 1px solid rgba(18,49,41,0.12);
      border-radius: 2.5mm;
      overflow: hidden;
    }
    thead th {
      background: linear-gradient(135deg, #0A5C3E, #146A45);
      color: #ffffff;
      text-align: left;
      padding: 3mm 3.5mm;
      font-size: 3mm;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    tbody td {
      padding: 3.35mm 3.5mm;
      border-top: 1px solid rgba(18,49,41,0.10);
      color: var(--text-main);
      font-size: 3.35mm;
      vertical-align: top;
    }
    .desc-title {
      font-weight: 700;
      margin-bottom: 1mm;
      color: var(--text-main);
      font-size: 3.65mm;
    }
    .desc-body {
      color: #4d655d;
      font-size: 3.05mm;
      line-height: 1.28;
    }
    .amount-cell {
      text-align: right;
      font-weight: 700;
      white-space: nowrap;
    }
    .payment-totals {
      margin-top: 4mm;
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 6mm;
      align-items: start;
    }
    .payment-box, .totals-box {
      border: 1px solid rgba(18,49,41,0.12);
      border-radius: 2.5mm;
      background: rgba(248,249,247,0.75);
    }
    .box-head {
      padding: 3mm 3.5mm 1.5mm;
      color: var(--brand-gold);
      font-family: var(--heading-font);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 3.1mm;
    }
    .box-body {
      padding: 0 3.5mm 3.5mm;
      color: #2f4a41;
      font-size: 3.3mm;
      line-height: 1.36;
    }
    .detail-row {
      display: grid;
      grid-template-columns: 24mm 3mm 1fr;
      gap: 1.5mm;
      margin-bottom: 0.8mm;
    }
    .detail-row .key {
      font-weight: 700;
      color: var(--text-main);
      text-transform: uppercase;
      font-size: 2.95mm;
    }
    .detail-row .sep {
      color: #7d8f88;
      text-align: center;
    }
    .detail-row .val {
      word-break: break-word;
    }
    .hash {
      font-family: "Courier New", monospace;
      font-size: 2.8mm;
      color: #28453d;
    }
    .tx-list {
      margin-top: 2.4mm;
      padding-top: 2.4mm;
      border-top: 1px solid rgba(18,49,41,0.10);
    }
    .tx-row {
      padding: 1.8mm 0;
      border-bottom: 1px solid rgba(18,49,41,0.08);
    }
    .tx-row:last-child {
      border-bottom: none;
    }
    .tx-main {
      display: flex;
      justify-content: space-between;
      gap: 3mm;
      color: var(--text-main);
      font-size: 2.9mm;
    }
    .tx-muted {
      margin-top: 0.8mm;
      color: #5e746d;
      font-size: 2.55mm;
      word-break: break-word;
    }
    .tx-hash {
      margin-top: 0.8mm;
      font-family: "Courier New", monospace;
      font-size: 2.45mm;
      color: #28453d;
      word-break: break-all;
    }
    .totals-box .line {
      display: flex;
      justify-content: space-between;
      gap: 4mm;
      padding: 3mm 3.5mm;
      border-top: 1px solid rgba(18,49,41,0.10);
      font-size: 3.3mm;
      color: var(--text-main);
    }
    .totals-box .line:first-of-type {
      border-top: none;
    }
    .totals-box .grand {
      background: var(--brand-green);
      color: white;
      font-size: 4.4mm;
      font-weight: 800;
      padding: 3.4mm 3.5mm;
    }
    .notes-and-proof {
      margin-top: 4mm;
      display: grid;
      grid-template-columns: 1fr 0.9fr;
      gap: 6mm;
      align-items: start;
    }
    .proof-box {
      position: relative;
      min-height: 28mm;
      border: 1px dashed rgba(10,92,62,0.38);
      border-radius: 2.5mm;
      background: rgba(251,247,233,0.42);
      padding: 3.5mm;
      overflow: hidden;
    }
    .proof-box .stamp {
      position: absolute;
      right: 2mm;
      bottom: 1mm;
      width: 28mm;
      opacity: 0.08;
    }
    .proof-box ul {
      margin: 1.4mm 0 0;
      padding-left: 3.8mm;
      color: #36534a;
      font-size: 2.9mm;
      line-height: 1.28;
    }
    .footer-band {
      margin-top: auto;
      background:
        radial-gradient(circle at bottom left, rgba(212,175,55,0.16), transparent 24%),
        radial-gradient(circle at 95% 50%, rgba(212,175,55,0.08), transparent 22%),
        linear-gradient(180deg, #0A5C3E, #093f2d);
      color: white;
      padding: 6.2mm 8mm 5mm;
      border-top: 1.1mm solid #D4AF37;
      border-radius: 0;
    }
    .footer-band .row {
      margin: 0;
      display: grid;
      grid-template-columns: 0.9fr 1px 1.65fr;
      gap: 7mm;
      align-items: stretch;
    }
    .footer-left {
      display: flex;
      align-items: center;
      gap: 5mm;
    }
    .footer-left .mini-logo {
      width: 18mm;
      opacity: 0.88;
    }
    .footer-left .thanks {
      font-family: var(--heading-font);
      font-size: 6.9mm;
      font-weight: 800;
      line-height: 1;
    }
    .footer-left .sub {
      color: var(--brand-gold);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 0.9mm;
      font-size: 3.15mm;
      font-weight: 700;
    }
    .footer-divider {
      width: 1px;
      background: rgba(255,255,255,0.28);
    }
    .footer-points {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4mm;
      font-size: 2.8mm;
      color: rgba(255,255,255,0.9);
      position: relative;
    }
    .footer-points strong {
      display: block;
      color: white;
      margin-bottom: 1mm;
      font-size: 3.05mm;
    }
    .copyright {
      margin-top: 3.6mm;
      text-align: center;
      font-size: 2.65mm;
      color: rgba(255,255,255,0.82);
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">
      <div class="header">
        <div class="brand-wrap">
          ${logo ? `<img src="${logo}" alt="Axistra Technologies" />` : `<div style="font-size:12mm;font-weight:800;color:#0A5C3E;">AXISTRA</div>`}
        </div>
        <div class="header-divider"></div>
        <div class="company-card">
          <h2>${escapeHtml(COMPANY.name)}</h2>
          ${iconLabel(ICONS.location, `${escapeHtml(COMPANY.addressLines[0])}, ${escapeHtml(COMPANY.addressLines[1])}, ${escapeHtml(COMPANY.addressLines[2])}`)}
          ${iconLabel(ICONS.email, escapeHtml(COMPANY.email))}
          ${iconLabel(ICONS.phone, escapeHtml(COMPANY.phone))}
          ${iconLabel(ICONS.web, escapeHtml(COMPANY.website))}
          <p class="legal">License No: ${escapeHtml(COMPANY.license)}</p>
          <p class="legal">Registration No: ${escapeHtml(COMPANY.registrationNo)}</p>
          <p class="legal">TRN: ${escapeHtml(COMPANY.trn)}</p>
        </div>
      </div>

      <div class="section-rule"></div>

      <div class="hero">
        <div class="bill-card">
          <div class="eyebrow">Bill To</div>
          <h3>${customerName}</h3>
          ${customerCompany ? `<p>${customerCompany}</p>` : ''}
          ${customerAddressLines.map((line) => `<p>${line}</p>`).join('')}
          ${customerCountry ? `<p>${customerCountry}</p>` : ''}
          ${customerPhone ? iconLabel(ICONS.phone, customerPhone) : ''}
          ${customerEmail ? iconLabel(ICONS.email, customerEmail) : ''}
        </div>
        <div class="invoice-card">
          <div class="invoice-title">INVOICE</div>
          <div class="invoice-number">#${invoiceNumber}</div>
          <div class="meta-grid">
            <div class="label">Invoice Date</div><div>${formatDate(issuedDate)}</div>
            <div class="label">Due Date</div><div>${formatDate(dueDate)}</div>
            <div class="label">Issue Date</div><div>${formatDate(issuedDate)}</div>
            <div class="label">Currency</div><div>${currency}</div>
            <div class="label">Status</div><div><span class="status-badge">${status}</span></div>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:8%">#</th>
            <th style="width:58%">Description</th>
            <th style="width:12%">Qty</th>
            <th style="width:22%; text-align:right;">Amount (${currency})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>
              <div class="desc-title">${serviceName}</div>
              <div class="desc-body">${serviceDescription}</div>
            </td>
            <td>1</td>
            <td class="amount-cell">${amount}</td>
          </tr>
        </tbody>
      </table>

      <div class="payment-totals">
        <div class="payment-box">
          <div class="box-head">Payment Information</div>
          <div class="box-body">
            <div class="detail-row"><div class="key">Method</div><div class="sep">:</div><div class="val">${paymentMethod || 'Manual / Recorded externally'}</div></div>
            <div class="detail-row"><div class="key">Service</div><div class="sep">:</div><div class="val">${escapeHtml(COMPANY.service)}</div></div>
            ${coin ? `<div class="detail-row"><div class="key">Coin</div><div class="sep">:</div><div class="val">${coin}</div></div>` : ''}
            ${network ? `<div class="detail-row"><div class="key">Network</div><div class="sep">:</div><div class="val">${network}</div></div>` : ''}
            ${txHash ? `<div class="detail-row"><div class="key">TX Hash</div><div class="sep">:</div><div class="val hash">${txHash}</div></div>` : ''}
            ${gatewayRows ? `<div class="tx-list">${gatewayRows}</div>` : ''}
          </div>
        </div>

        <div class="totals-box">
          <div class="box-head">Summary</div>
          <div class="line"><span>Subtotal</span><strong>${amount}</strong></div>
          <div class="line"><span>Discount</span><strong>0.00</strong></div>
          <div class="line"><span>VAT</span><strong>0.00</strong></div>
          <div class="line grand"><span>Total (${currency})</span><span>${amount}</span></div>
        </div>
      </div>

      <div class="notes-and-proof">
        <div class="payment-box">
          <div class="box-head">Notes</div>
          <div class="box-body">
            Thank you for your business.<br />
            This invoice reflects prepaid software usage credits and related digital services supplied by ${escapeHtml(COMPANY.name)}.
          </div>
        </div>

        <div class="proof-box">
          <div class="box-head" style="padding:0;color:#0A5C3E;">Digital Verification</div>
          <ul>
            <li>Issued electronically by ${escapeHtml(COMPANY.name)}</li>
            <li>Registration No. ${escapeHtml(COMPANY.registrationNo)} | License No. ${escapeHtml(COMPANY.license)}</li>
            ${txHash ? `<li>Linked to blockchain transaction proof</li>` : '<li>Payment evidence maintained in Axistra internal records</li>'}
          </ul>
          ${stamp ? `<img class="stamp" src="${stamp}" alt="Axistra digital stamp" />` : ''}
        </div>
      </div>
    </div>

    <div class="footer-band">
      <div class="row">
        <div class="footer-left">
          ${logo ? `<img class="mini-logo" src="${logo}" alt="Axistra" />` : ''}
          <div>
            <div class="thanks">THANK YOU</div>
            <div class="sub">For Your Business</div>
          </div>
        </div>
        <div class="footer-divider"></div>
        <div class="footer-points">
          <div><strong>Reliable Support</strong>We are here to help you any time.</div>
          <div><strong>Secure Solutions</strong>Delivering secure and scalable technology.</div>
          <div><strong>Driving Growth</strong>Innovating today for a better tomorrow.</div>
        </div>
      </div>
      <div class="copyright">${escapeHtml(COMPANY.name)} · ${escapeHtml(COMPANY.authority)} · TRN ${escapeHtml(COMPANY.trn)}</div>
    </div>
  </div>
</body>
</html>`;
}

export async function renderInvoicePdf(inv: InvoiceView): Promise<Buffer> {
  const cacheKey = invoiceCacheKey(inv);
  const cached = pdfCache.get(cacheKey);
  if (cached) return cached;

  const html = renderInvoiceHtml(inv);
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    await page.close();
    const buffer = Buffer.from(pdf);
    pdfCache.set(cacheKey, buffer);
    return buffer;
  } catch (e) {
    return Buffer.from(html, 'utf-8');
  }
}
