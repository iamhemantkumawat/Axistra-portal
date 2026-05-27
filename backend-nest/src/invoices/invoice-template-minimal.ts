import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Invoice } from '../entities/invoice.entity';

type InvoiceView = Invoice & {
  customer_phone?: string;
  customer_address?: string;
  payment_transactions?: Array<any>;
};

const COMPANY = {
  legalName: 'AXISTRA TECHNOLOGIES - FZCO',
  trn: '105415374500001',
  license: '86256',
  registrationNo: '79504',
  addressLine1: 'IFZA Business Park, DDP, Dubai Silicon Oasis,',
  addressLine2: 'Dubai, United Arab Emirates',
  phone: '+971 4 123 4567',
  email: 'info@axistratech.com',
  website: 'www.axistratech.com',
  bank: {
    name: 'Wio Bank',
    accountName: 'AXISTRA TECHNOLOGIES - FZCO',
    accountNumber: '1012345678901',
    iban: 'AE03 7350 1012 3456 7890 101',
    swift: 'WIOBAEAD',
  },
  service: 'SaaS Platform Usage Credits',
  description: 'Prepaid credits for usage of Axistra cloud software platform and related digital services.',
};

const ASSET_DIR = join(process.cwd(), 'assets');
const assetCache = new Map<string, string>();
const pdfCache = new Map<string, Buffer>();
let browserPromise: Promise<any> | null = null;

function formatDate(value?: Date | string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function cacheKey(inv: InvoiceView) {
  return 'minimal-v2::' + JSON.stringify({
    n: inv.invoice_number, s: inv.status, a: inv.amount, c: inv.currency,
    t: inv.tx_hash, m: inv.payment_method, co: inv.crypto_coin, nw: inv.crypto_network,
    i: inv.issued_date, cn: inv.customer_name, ce: inv.customer_email,
    cc: inv.customer_company, cp: inv.customer_phone, ca: inv.customer_address,
    px: inv.payment_transactions,
  });
}

function moneyFmt(n: any) {
  const v = parseFloat(n || 0);
  return v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amountInWords(num: number, currencyLabel = 'Dirhams'): string {
  if (!Number.isFinite(num)) return '';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const intPart = Math.floor(num);
  const fraction = Math.round((num - intPart) * 100);
  const toWords = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + toWords(n % 100) : '');
    if (n < 1_000_000) return toWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + toWords(n % 1000) : '');
    if (n < 1_000_000_000) return toWords(Math.floor(n / 1_000_000)) + ' Million' + (n % 1_000_000 ? ' ' + toWords(n % 1_000_000) : '');
    return String(n);
  };
  const main = toWords(intPart).trim() || 'Zero';
  const frac = fraction > 0 ? ` and ${toWords(fraction).trim()} Fils` : '';
  return `${main}${frac} ${currencyLabel} Only`;
}

interface LineItem {
  description: string;
  detail?: string;
  qty: number;
  unit_price: number;
  amount: number;
}

function buildLineItems(inv: InvoiceView): LineItem[] {
  // For now, a single-line invoice based on the recharge / service.
  // Future-proofed for multi-line invoices.
  const amount = parseFloat(inv.amount || '0');
  const description = inv.service_name || COMPANY.service;
  let detail = inv.service_description || COMPANY.description;
  if (inv.payment_method) {
    const coinNet = [inv.crypto_coin, inv.crypto_network].filter(Boolean).join('/');
    detail += ` Payment: ${inv.payment_method}${coinNet ? ` (${coinNet})` : ''}.`;
  }
  return [{
    description,
    detail,
    qty: 1,
    unit_price: amount,
    amount,
  }];
}

export function renderMinimalInvoiceHtml(inv: InvoiceView): string {
  const issued = inv.issued_date ? new Date(inv.issued_date) : new Date(inv.created_at);
  const due = new Date(issued); due.setDate(due.getDate() + 7);
  const logo = getAssetDataUri('axistra-landscape.png') || getAssetDataUri('axistra-invoice-logo.png');
  const logoDark = getAssetDataUri('axistra-landscape-dark.png') || logo;
  const items = buildLineItems(inv);
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const discountPct = 0;
  const discount = subtotal * (discountPct / 100);
  const vatPct = 0; // services to non-resident customers (zero-rated export)
  const vat = (subtotal - discount) * (vatPct / 100);
  const total = subtotal - discount + vat;
  const currency = (inv.currency || 'AED').toUpperCase();
  const currencyWordLabel = currency === 'AED' ? 'Dirhams' : currency === 'USD' ? 'US Dollars' : currency === 'EUR' ? 'Euros' : currency;
  const itemsRows = items.map((it, idx) => `
    <tr class="${idx % 2 === 0 ? 'odd' : 'even'}">
      <td class="num">${idx + 1}</td>
      <td class="desc">
        <div class="d-title">${escapeHtml(it.description)}</div>
        ${it.detail ? `<div class="d-sub">${escapeHtml(it.detail)}</div>` : ''}
      </td>
      <td class="qty">${it.qty}</td>
      <td class="unit">${moneyFmt(it.unit_price)}</td>
      <td class="amt">${moneyFmt(it.amount)}</td>
    </tr>`).join('');

  const status = String(inv.status || 'unpaid').toUpperCase();

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Invoice ${escapeHtml(inv.invoice_number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root {
    --ink: #0E1B17;
    --soft: #4B5C56;
    --muted: #8A9A93;
    --line: #E3E7E5;
    --bg: #FFFFFF;
    --green-deep: #0B5239;
    --green: #0A5C3E;
    --green-soft: #E9F1EC;
    --gold: #C6A14B;
    --gold-soft: #F7E7B3;
    --cream: #FBF3DC;
    --row-alt: #FFF6E5;
  }
  body {
    margin: 0;
    font-family: "Manrope", "Plus Jakarta Sans", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    height: 297mm;
    margin: 0 auto;
    background: #fff;
    position: relative;
    padding: 11mm 12mm 0;
    display: flex;
    flex-direction: column;
  }

  /* ====== HEADER ====== */
  header.top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 6mm;
  }
  header.top .logo {
    display: flex;
    align-items: center;
    height: 24mm;
  }
  header.top .logo img { height: 22mm; width: auto; max-width: 95mm; object-fit: contain; }
  header.top .right {
    text-align: right;
    font-size: 9pt;
    line-height: 1.5;
    color: var(--ink);
    max-width: 88mm;
  }
  header.top .co {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 11pt; font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--ink);
    margin-bottom: 2.5mm;
  }
  header.top .right .line { display: flex; align-items: flex-start; gap: 6px; justify-content: flex-end; font-size: 8.5pt; color: var(--soft); margin: 0.6mm 0; }
  header.top .right .line .ico { width: 12px; height: 12px; color: var(--green); flex-shrink: 0; margin-top: 1.2mm; }
  header.top .right .line span.txt { font-size: 8.5pt; color: var(--ink); }

  .gold-divider {
    height: 1.2px;
    background: linear-gradient(90deg, var(--gold) 0%, var(--gold-soft) 60%, transparent 100%);
    margin: 0 0 8mm;
  }

  /* ====== BILL TO + INVOICE BLOCK ====== */
  .bill-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8mm;
    margin-bottom: 8mm;
  }
  .bill .label, .meta .label {
    font-size: 8.5pt;
    letter-spacing: 0.18em;
    font-weight: 700;
    color: var(--gold);
    text-transform: uppercase;
    margin-bottom: 2mm;
  }
  .bill .who {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 14pt; font-weight: 800; color: var(--ink);
    margin: 0 0 2mm;
  }
  .bill .line { font-size: 9pt; color: var(--soft); margin: 0.4mm 0; }
  .bill .icoline { font-size: 9pt; color: var(--soft); display: flex; align-items: center; gap: 5px; margin: 1mm 0 0; }
  .bill .icoline .ico { width: 12px; height: 12px; color: var(--green); }

  .invoice-block { text-align: right; }
  .invoice-block .word {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 40pt; font-weight: 800; letter-spacing: 0.02em;
    color: var(--green-deep);
    line-height: 1;
    margin: 0 0 2mm;
  }
  .invoice-block .inv-no {
    font-family: "Plus Jakarta Sans", sans-serif;
    color: var(--gold);
    font-size: 12pt; font-weight: 700;
    margin: 0 0 4mm;
    letter-spacing: 0.01em;
  }
  .invoice-block table { margin-left: auto; border-collapse: collapse; }
  .invoice-block td {
    font-size: 9pt;
    padding: 0.8mm 0;
    vertical-align: top;
  }
  .invoice-block td.k {
    text-align: right;
    color: var(--ink);
    font-weight: 700;
    letter-spacing: 0.04em;
    padding-right: 5mm;
    text-transform: uppercase;
    font-size: 8.5pt;
  }
  .invoice-block td.sep { padding: 0 2mm; color: var(--muted); }
  .invoice-block td.v { color: var(--soft); text-align: left; min-width: 30mm; }

  /* ====== ITEMS TABLE ====== */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6mm;
    table-layout: fixed;
    font-size: 9pt;
  }
  table.items thead th {
    background: var(--green);
    color: #fff;
    font-size: 9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
    padding: 3.5mm 4mm;
    text-align: left;
  }
  table.items thead th.center { text-align: center; }
  table.items thead th.right { text-align: right; }
  table.items thead th.num-col { width: 10mm; text-align: center; }
  table.items thead th.qty-col { width: 18mm; text-align: center; }
  table.items thead th.unit-col, table.items thead th.amt-col { width: 32mm; text-align: right; }

  table.items tbody td { padding: 3.2mm 4mm; vertical-align: top; font-size: 9pt; }
  table.items tbody tr.odd  td { background: var(--row-alt); }
  table.items tbody tr.even td { background: transparent; }
  table.items tbody td.num { text-align: center; color: var(--soft); font-weight: 600; }
  table.items tbody td.qty { text-align: center; color: var(--ink); }
  table.items tbody td.unit, table.items tbody td.amt { text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
  table.items tbody td.desc .d-title { font-weight: 700; color: var(--ink); margin-bottom: 0.6mm; }
  table.items tbody td.desc .d-sub { color: var(--soft); font-size: 8.5pt; line-height: 1.45; }

  /* ====== PAYMENT + TOTALS ====== */
  .pay-totals {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: 10mm;
    margin-bottom: 4mm;
  }
  .pay h4 {
    font-size: 8.5pt;
    letter-spacing: 0.18em;
    color: var(--gold);
    text-transform: uppercase;
    margin: 0 0 2.5mm;
    font-weight: 700;
  }
  .pay table { border-collapse: collapse; font-size: 9pt; }
  .pay td { padding: 0.8mm 0; vertical-align: top; }
  .pay td.k {
    color: var(--ink);
    font-weight: 700;
    letter-spacing: 0.05em;
    padding-right: 4mm;
    text-transform: uppercase;
    font-size: 8.5pt;
    white-space: nowrap;
  }
  .pay td.sep { color: var(--muted); padding-right: 3mm; }
  .pay td.v { color: var(--soft); }

  .totals { font-size: 10pt; }
  .totals .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2.5mm 4mm;
    border-bottom: 1px solid var(--line);
  }
  .totals .row .k { color: var(--ink); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 9pt; }
  .totals .row .v { color: var(--ink); font-variant-numeric: tabular-nums; font-weight: 600; }
  .totals .row.grand {
    background: var(--green);
    color: #fff;
    padding: 4mm;
    margin-top: 1mm;
    border: none;
  }
  .totals .row.grand .k { color: #fff; font-size: 10pt; }
  .totals .row.grand .v { color: #fff; font-size: 13pt; font-weight: 800; }

  .amount-words {
    margin-top: 2.5mm;
    text-align: right;
    color: var(--green-deep);
    font-style: italic;
    font-size: 9pt;
  }
  .amount-words .lbl { color: var(--green); font-weight: 700; font-style: italic; }

  /* ====== NOTES ====== */
  .notes {
    margin-top: 5mm;
    font-size: 9pt;
    color: var(--soft);
  }
  .notes .lbl {
    font-size: 8.5pt;
    letter-spacing: 0.18em;
    color: var(--gold);
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 1.5mm;
  }

  /* ====== STAMP (compact, top-right of notes block) ====== */
  .stamp-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 4mm;
  }
  .stamp-row .stamp { text-align: right; }
  .stamp-row .stamp img { height: 22mm; opacity: 0.92; }

  /* ====== FOOTER ====== */
  .grow {
    flex: 1 1 auto;
  }
  footer.green-bar {
    width: 100%;
    background: var(--green-deep);
    color: #fff;
    padding: 5mm 12mm 5mm;
    margin: 0 -12mm;
    position: relative;
  }
  footer.green-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 80% 100%, rgba(255,255,255,0.06), transparent 60%);
    pointer-events: none;
  }
  footer.green-bar .row1 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    align-items: center;
    gap: 6mm;
    position: relative;
  }
  footer.green-bar .ty { display: flex; align-items: center; gap: 4mm; }
  footer.green-bar .ty img { height: 13mm; }
  footer.green-bar .ty .text { line-height: 1.05; }
  footer.green-bar .ty .text .l1 {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 13pt;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  footer.green-bar .ty .text .l2 {
    color: var(--gold);
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.18em;
  }
  footer.green-bar .feat { display: flex; align-items: center; gap: 3.5mm; }
  footer.green-bar .feat .ico {
    width: 9mm; height: 9mm;
    border: 1.4px solid var(--gold);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--gold);
    flex-shrink: 0;
  }
  footer.green-bar .feat .ico svg { width: 4.5mm; height: 4.5mm; stroke: currentColor; }
  footer.green-bar .feat .t .ttl { font-size: 9pt; font-weight: 700; letter-spacing: 0.02em; color: #fff; }
  footer.green-bar .feat .t .sub { font-size: 7.5pt; color: rgba(255,255,255,0.78); line-height: 1.35; max-width: 38mm; }

  footer.green-bar .row2 {
    margin-top: 4mm;
    padding-top: 3mm;
    border-top: 1px solid rgba(255,255,255,0.18);
    text-align: center;
    font-size: 8pt;
    letter-spacing: 0.12em;
    color: rgba(255,255,255,0.92);
  }

  /* ====== STATUS BADGE (corner) ====== */
  .status-tag {
    position: absolute;
    top: 6mm;
    right: 12mm;
    font-size: 7pt;
    letter-spacing: 0.22em;
    font-weight: 700;
    padding: 1mm 3mm;
    border-radius: 999px;
    text-transform: uppercase;
  }
  .status-tag.paid { background: var(--green-soft); color: var(--green-deep); border:1px solid #C6E2D2; }
  .status-tag.unpaid { background: var(--cream); color: #8A5800; border:1px solid var(--gold-soft); }
  .status-tag.failed { background:#FCEAEA; color:#9B1C1C; border:1px solid #F4C3C3; }
</style></head>
<body>
  <div class="page">

    <span class="status-tag ${status === 'PAID' ? 'paid' : status === 'REFUNDED' || status === 'FAILED' ? 'failed' : 'unpaid'}">${escapeHtml(status)}</span>

    <header class="top">
      <div class="logo">
        ${logo ? `<img src="${logo}" alt="Axistra Technologies" />` : ''}
      </div>
      <div class="right">
        <div class="co">${escapeHtml(COMPANY.legalName)}</div>
        <div class="line">
          <span class="txt">${escapeHtml(COMPANY.addressLine1)}<br/>${escapeHtml(COMPANY.addressLine2)}</span>
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="line"><span class="txt">${escapeHtml(COMPANY.phone)}</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.95.34 1.88.63 2.78a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.11-.45c.9.29 1.83.5 2.78.63A2 2 0 0 1 22 16.92Z"/></svg></div>
        <div class="line"><span class="txt">${escapeHtml(COMPANY.email)}</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>
        <div class="line"><span class="txt">${escapeHtml(COMPANY.website)}</span><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></div>
      </div>
    </header>

    <div class="gold-divider"></div>

    <section class="bill-row">
      <div class="bill">
        <div class="label">Bill To</div>
        <div class="who">${escapeHtml(inv.customer_company || inv.customer_name || 'Customer')}</div>
        ${inv.customer_company && inv.customer_name ? `<div class="line">${escapeHtml(inv.customer_name)}</div>` : ''}
        ${inv.customer_address ? String(inv.customer_address).split(/\r?\n|,\s*/).filter(Boolean).slice(0,3).map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('') : ''}
        ${inv.customer_country ? `<div class="line">${escapeHtml(inv.customer_country)}</div>` : ''}
        ${inv.customer_phone ? `<div class="icoline"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.95.34 1.88.63 2.78a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.11-.45c.9.29 1.83.5 2.78.63A2 2 0 0 1 22 16.92Z"/></svg>${escapeHtml(inv.customer_phone)}</div>` : ''}
        ${inv.customer_email ? `<div class="icoline"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>${escapeHtml(inv.customer_email)}</div>` : ''}
      </div>

      <div class="invoice-block">
        <div class="word">INVOICE</div>
        <div class="inv-no">#${escapeHtml(inv.invoice_number)}</div>
        <table>
          <tr><td class="k">Invoice Date</td><td class="sep">:</td><td class="v">${formatDate(issued)}</td></tr>
          <tr><td class="k">Due Date</td><td class="sep">:</td><td class="v">${formatDate(due)}</td></tr>
          <tr><td class="k">Issue Date</td><td class="sep">:</td><td class="v">${formatDate(issued)}</td></tr>
          <tr><td class="k">Currency</td><td class="sep">:</td><td class="v">${escapeHtml(currency)}</td></tr>
        </table>
      </div>
    </section>

    <table class="items">
      <thead>
        <tr>
          <th class="num-col">#</th>
          <th>Description</th>
          <th class="qty-col">QTY</th>
          <th class="unit-col">Unit Price (${escapeHtml(currency)})</th>
          <th class="amt-col">Amount (${escapeHtml(currency)})</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <section class="pay-totals">
      <div class="pay">
        <h4>Payment Information</h4>
        <table>
          <tr><td class="k">Bank Name</td><td class="sep">:</td><td class="v">${escapeHtml(COMPANY.bank.name)}</td></tr>
          <tr><td class="k">Account Name</td><td class="sep">:</td><td class="v">${escapeHtml(COMPANY.bank.accountName)}</td></tr>
          <tr><td class="k">Account Number</td><td class="sep">:</td><td class="v">${escapeHtml(COMPANY.bank.accountNumber)}</td></tr>
          <tr><td class="k">IBAN</td><td class="sep">:</td><td class="v">${escapeHtml(COMPANY.bank.iban)}</td></tr>
          <tr><td class="k">SWIFT / BIC</td><td class="sep">:</td><td class="v">${escapeHtml(COMPANY.bank.swift)}</td></tr>
        </table>
      </div>
      <div class="totals">
        <div class="row"><span class="k">Subtotal</span><span class="v">${moneyFmt(subtotal)}</span></div>
        <div class="row"><span class="k">Discount${discountPct ? ` (${discountPct}%)` : ''}</span><span class="v">${discount > 0 ? '-' + moneyFmt(discount) : moneyFmt(0)}</span></div>
        <div class="row"><span class="k">VAT${vatPct ? ` (${vatPct}%)` : ' (0%, zero-rated)'}</span><span class="v">${moneyFmt(vat)}</span></div>
        <div class="row grand"><span class="k">Total (${escapeHtml(currency)})</span><span class="v">${moneyFmt(total)}</span></div>
        <div class="amount-words"><span class="lbl">Amount in Words:</span><br/>${escapeHtml(amountInWords(total, currencyWordLabel))}</div>
      </div>
    </section>

    <div class="notes">
      <div class="lbl">Notes</div>
      Thank you for your business! Please make the payment within the due date.
      ${inv.tx_hash ? `<div style="margin-top:1.5mm;font-size:8.5pt;color:var(--soft);">TX Reference: <span style="font-family:'JetBrains Mono',monospace;">${escapeHtml(inv.tx_hash)}</span></div>` : ''}
    </div>

    <div class="grow"></div>

    <footer class="green-bar">
      <div class="row1">
        <div class="ty">
          ${logoDark ? `<img src="${logoDark}" alt="Axistra" />` : ''}
          <div class="text">
            <div class="l1">THANK YOU</div>
            <div class="l2">FOR YOUR BUSINESS</div>
          </div>
        </div>
        <div class="feat">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 18 0v3a3 3 0 0 1-3 3h-1v-6h4M3 12v3a3 3 0 0 0 3 3h1v-6H3"/></svg></div>
          <div class="t"><div class="ttl">Reliable Support</div><div class="sub">We're here to help you anytime.</div></div>
        </div>
        <div class="feat">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z"/></svg></div>
          <div class="t"><div class="ttl">Secure Solutions</div><div class="sub">Delivering secure and scalable technology.</div></div>
        </div>
        <div class="feat">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V11M9 21V7M15 21V13M21 21V3"/></svg></div>
          <div class="t"><div class="ttl">Driving Growth</div><div class="sub">Innovating today for a better tomorrow.</div></div>
        </div>
      </div>
      <div class="row2">${escapeHtml(COMPANY.legalName)}. All rights reserved. · TRN ${escapeHtml(COMPANY.trn)} · License ${escapeHtml(COMPANY.license)}</div>
    </footer>
  </div>
</body></html>`;
}

export async function renderMinimalInvoicePdf(inv: InvoiceView): Promise<Buffer> {
  const key = cacheKey(inv);
  if (pdfCache.has(key)) return pdfCache.get(key)!;
  const html = renderMinimalInvoiceHtml(inv);
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      pageRanges: '1',
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await page.close();
    pdfCache.set(key, buf);
    return buf;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[renderMinimalInvoicePdf] puppeteer failed:', err);
    return Buffer.from(html, 'utf-8');
  }
}

export function clearMinimalInvoiceCache() { pdfCache.clear(); assetCache.clear(); }
