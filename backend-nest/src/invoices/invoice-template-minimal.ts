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
    aed_value?: string;
    aed_rate_at_payment?: string;
  }>;
};

const COMPANY = {
  name: 'AXISTRA TECHNOLOGIES — FZCO',
  tagline: 'Innovate • Connect • Grow',
  trn: '105415374500001',
  license: '86256',
  registrationNo: '79504',
  address: 'IFZA Business Park, DDP, Dubai Silicon Oasis, United Arab Emirates',
  authority: 'Dubai Silicon Oasis / IFZA',
  website: 'www.axistratech.com',
  email: 'info@axistratech.com',
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  return 'minimal::' + JSON.stringify({
    n: inv.invoice_number, s: inv.status, a: inv.amount, c: inv.currency,
    t: inv.tx_hash, m: inv.payment_method, co: inv.crypto_coin, nw: inv.crypto_network,
    i: inv.issued_date, cn: inv.customer_name, ce: inv.customer_email,
    cc: inv.customer_company, cp: inv.customer_phone, ca: inv.customer_address,
    px: inv.payment_transactions,
  });
}

export function renderMinimalInvoiceHtml(inv: InvoiceView): string {
  const issued = inv.issued_date ? new Date(inv.issued_date) : new Date(inv.created_at);
  const due = new Date(issued); due.setDate(due.getDate() + 7);
  const amount = parseFloat(inv.amount || '0').toFixed(2);
  const logo = getAssetDataUri('axistra-invoice-logo.png');
  const stamp = getAssetDataUri('digital-stamp.png');
  const status = String(inv.status || 'unpaid').toUpperCase();
  const statusClass = status === 'PAID' ? 'paid' : status === 'REFUNDED' || status === 'FAILED' ? 'failed' : 'unpaid';
  const txs = Array.isArray(inv.payment_transactions) ? inv.payment_transactions : [];
  const txRows = txs.map((tx) => {
    const coin = [tx.crypto_amount || tx.received_amount, tx.coin, tx.network].filter(Boolean).join(' ');
    const usdt = tx.final_usdt_amount ? `${tx.final_usdt_amount} USDT` : '';
    return `
      <tr>
        <td class="mono small">${escapeHtml(tx.tx_hash || '—')}</td>
        <td>${escapeHtml(coin || '—')}</td>
        <td>${escapeHtml(usdt || '—')}</td>
        <td>${escapeHtml(tx.aed_value || '—')}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Invoice ${escapeHtml(inv.invoice_number)}</title>
<style>
  @page { margin: 0; size: A4; }
  * { box-sizing: border-box; }
  :root {
    --ink: #0E1B17;
    --soft: #4B5C56;
    --muted: #889A93;
    --line: #E3E7E5;
    --green: #0A5C3E;
    --gold: #C6A14B;
  }
  body { margin:0; font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: var(--ink); background:#fff; -webkit-font-smoothing:antialiased; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 22mm 22mm 18mm; background:#fff; position:relative; }
  .corner-mark { position:absolute; top:0; left:0; width:0; height:0; border-top:14mm solid var(--green); border-right:14mm solid transparent; }
  .gold-line { position:absolute; top:18mm; left:22mm; right:22mm; height:1px; background: linear-gradient(90deg, var(--gold), transparent 80%); }
  header { display:flex; justify-content: space-between; align-items: flex-start; margin-top: 0; }
  .brand { display:flex; align-items:center; gap: 14px; }
  .brand img { height: 44px; }
  .brand .name { font-size: 11px; letter-spacing: 0.18em; color: var(--soft); text-transform: uppercase; }
  .brand .co { font-size: 18px; font-weight: 700; color: var(--ink); margin-top: 2px; }
  .doctype { text-align:right; }
  .doctype .label { font-size: 10px; letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; }
  .doctype h1 { font-size: 36px; letter-spacing: 0.04em; margin: 2px 0 0; color: var(--ink); font-weight: 600; }
  .doctype .num { margin-top: 4px; font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 13px; color: var(--soft); }
  .status-pill { display:inline-block; margin-top: 8px; padding: 4px 10px; border-radius: 999px; font-size: 10px; letter-spacing: 0.16em; font-weight: 600; }
  .status-pill.paid { background: #ECF6F0; color: #0A5C3E; border:1px solid #C6E2D2; }
  .status-pill.unpaid { background: #FFF5E6; color: #8A5800; border:1px solid #F0D9A8; }
  .status-pill.failed { background:#FCEAEA; color:#9B1C1C; border:1px solid #F4C3C3; }

  .meta { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 8mm; margin-top: 14mm; padding-top: 10mm; border-top: 1px solid var(--line); }
  .meta .block .k { font-size: 9px; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; }
  .meta .block .v { margin-top: 4px; font-size: 12px; color: var(--ink); }
  .meta .block .v strong { font-weight: 600; }

  .parties { display:grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 12mm; }
  .party h3 { margin: 0 0 6px; font-size: 9px; letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; font-weight: 600; }
  .party .name { font-size: 14px; font-weight: 600; color: var(--ink); }
  .party .line { font-size: 11px; color: var(--soft); margin-top: 2px; }

  table.items { width:100%; border-collapse: collapse; margin-top: 14mm; }
  table.items thead th { text-align:left; font-size: 10px; letter-spacing: 0.18em; color: var(--muted); text-transform: uppercase; font-weight: 600; padding: 0 0 8px; border-bottom: 1px solid var(--line); }
  table.items thead th.right { text-align:right; }
  table.items tbody td { padding: 10px 0 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .desc strong { display:block; font-size: 14px; color: var(--ink); margin-bottom: 4px; }
  .desc span { font-size: 11px; color: var(--soft); line-height: 1.5; }
  .qty, .unit, .total { font-family: "JetBrains Mono", "SF Mono", monospace; }
  .right { text-align:right; }

  .totals { margin-top: 10mm; display:flex; justify-content:flex-end; }
  .totals table { width: 80mm; border-collapse: collapse; }
  .totals td { padding: 6px 0; font-size: 12px; color: var(--soft); }
  .totals td.right { text-align:right; color: var(--ink); font-family: "JetBrains Mono", "SF Mono", monospace; }
  .totals tr.sum td { border-top: 1px solid var(--line); padding-top: 10px; }
  .totals tr.grand td { padding-top: 10px; }
  .totals tr.grand td.right { font-size: 20px; font-weight: 700; color: var(--ink); }
  .totals tr.grand td.label { font-size: 10px; letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; }

  .payment-trace { margin-top: 14mm; }
  .payment-trace h4 { font-size: 9px; letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; margin: 0 0 6px; font-weight:600; }
  .payment-trace table { width: 100%; border-collapse: collapse; }
  .payment-trace th, .payment-trace td { padding: 6px 8px; text-align:left; font-size: 10px; border-bottom: 1px solid var(--line); }
  .payment-trace th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.16em; font-weight: 600; }
  .mono { font-family: "JetBrains Mono", "SF Mono", monospace; }
  .small { font-size: 9.5px; word-break: break-all; }

  .notes { display:grid; grid-template-columns: 1.4fr 1fr; gap: 10mm; margin-top: 16mm; }
  .notes .legal h5, .notes .pay h5 { font-size: 9px; letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; margin: 0 0 6px; font-weight: 600; }
  .notes p, .notes li { font-size: 10px; color: var(--soft); line-height: 1.55; margin: 0 0 4px; }
  .notes ul { padding-left: 14px; margin: 0; }

  .signoff { display:flex; justify-content: space-between; align-items: flex-end; margin-top: 16mm; padding-top: 8mm; border-top: 1px solid var(--line); }
  .signoff .left { font-size: 10px; color: var(--soft); max-width: 110mm; line-height: 1.5; }
  .signoff .stamp { text-align:right; }
  .signoff .stamp img { height: 28mm; opacity: 0.92; }
  .signoff .stamp .meta { font-size: 9px; color: var(--muted); margin-top: 4px; letter-spacing: 0.12em; }

  footer { position:absolute; bottom: 8mm; left: 22mm; right: 22mm; display:flex; justify-content: space-between; font-size: 9px; color: var(--muted); letter-spacing: 0.1em; }
  footer .l, footer .r { display:flex; gap: 16px; }
  footer strong { color: var(--soft); font-weight: 600; }
</style></head>
<body>
  <div class="page">
    <div class="corner-mark"></div>
    <div class="gold-line"></div>

    <header>
      <div class="brand">
        ${logo ? `<img src="${logo}" alt="Axistra" />` : ''}
        <div>
          <div class="name">Axistra Technologies</div>
          <div class="co">${escapeHtml(COMPANY.name)}</div>
        </div>
      </div>
      <div class="doctype">
        <div class="label">Tax Invoice</div>
        <h1>Invoice</h1>
        <div class="num">${escapeHtml(inv.invoice_number)}</div>
        <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
      </div>
    </header>

    <section class="meta">
      <div class="block"><div class="k">Issued</div><div class="v"><strong>${formatDate(issued)}</strong></div></div>
      <div class="block"><div class="k">Due</div><div class="v"><strong>${formatDate(due)}</strong></div></div>
      <div class="block"><div class="k">Currency</div><div class="v"><strong>${escapeHtml(inv.currency || 'USD')}</strong></div></div>
    </section>

    <section class="parties">
      <div class="party">
        <h3>Billed To</h3>
        <div class="name">${escapeHtml(inv.customer_name || 'Customer')}</div>
        ${inv.customer_company ? `<div class="line">${escapeHtml(inv.customer_company)}</div>` : ''}
        ${inv.customer_address ? `<div class="line">${escapeHtml(inv.customer_address)}</div>` : ''}
        ${inv.customer_country ? `<div class="line">${escapeHtml(inv.customer_country)}</div>` : ''}
        ${inv.customer_email ? `<div class="line">${escapeHtml(inv.customer_email)}</div>` : ''}
        ${inv.customer_phone ? `<div class="line">${escapeHtml(inv.customer_phone)}</div>` : ''}
      </div>
      <div class="party">
        <h3>From</h3>
        <div class="name">${escapeHtml(COMPANY.name)}</div>
        <div class="line">${escapeHtml(COMPANY.address)}</div>
        <div class="line">License No. ${escapeHtml(COMPANY.license)} · Reg. ${escapeHtml(COMPANY.registrationNo)}</div>
        <div class="line">TRN: ${escapeHtml(COMPANY.trn)}</div>
        <div class="line">${escapeHtml(COMPANY.email)} · ${escapeHtml(COMPANY.website)}</div>
      </div>
    </section>

    <table class="items">
      <thead>
        <tr>
          <th style="width:55%">Description</th>
          <th class="right" style="width:10%">Qty</th>
          <th class="right" style="width:17%">Unit</th>
          <th class="right" style="width:18%">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="desc">
            <strong>${escapeHtml(inv.service_name || COMPANY.service)}</strong>
            <span>${escapeHtml(inv.service_description || COMPANY.description)}</span>
            ${inv.payment_method ? `<span style="display:block;margin-top:6px;color:var(--muted)">Payment method: ${escapeHtml(inv.payment_method)}${inv.crypto_coin ? ` · ${escapeHtml(inv.crypto_coin)}${inv.crypto_network ? `/${escapeHtml(inv.crypto_network)}` : ''}` : ''}</span>` : ''}
          </td>
          <td class="qty right">1</td>
          <td class="unit right">${escapeHtml(inv.currency || 'USD')} ${amount}</td>
          <td class="total right">${escapeHtml(inv.currency || 'USD')} ${amount}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td class="right">${escapeHtml(inv.currency || 'USD')} ${amount}</td></tr>
        <tr><td>VAT (Reverse charge / Out of scope)</td><td class="right">${escapeHtml(inv.currency || 'USD')} 0.00</td></tr>
        <tr class="sum"><td>Net Total</td><td class="right">${escapeHtml(inv.currency || 'USD')} ${amount}</td></tr>
        <tr class="grand"><td class="label">Total Due</td><td class="right">${escapeHtml(inv.currency || 'USD')} ${amount}</td></tr>
      </table>
    </div>

    ${txRows ? `
    <section class="payment-trace">
      <h4>Payment Trace</h4>
      <table>
        <thead><tr><th>TX Hash</th><th>Coin / Network</th><th>USDT</th><th>AED</th></tr></thead>
        <tbody>${txRows}</tbody>
      </table>
    </section>` : ''}

    <section class="notes">
      <div class="legal">
        <h5>Legal & Tax</h5>
        <p>This is a system-generated tax invoice for digital services rendered by ${escapeHtml(COMPANY.name)}. Crypto received is treated as immediate sale per IFRS 15 and converted to AED at the date of receipt; the company holds zero on-chain inventory at month-end.</p>
        <p>VAT: Services rendered to non-resident customers are treated as zero-rated exports of services under UAE Federal Decree-Law No. 8 of 2017 Article 31.</p>
        <p>Trade License No. ${escapeHtml(COMPANY.license)} · ${escapeHtml(COMPANY.authority)} · Registration No. ${escapeHtml(COMPANY.registrationNo)}.</p>
      </div>
      <div class="pay">
        <h5>How to pay</h5>
        <ul>
          <li>Crypto: pay via the secure OxaPay/BTCPay link provided by your account manager.</li>
          <li>Bank: Wio Bank · Axistra Technologies — FZCO · AED</li>
          <li>Reference: <span class="mono">${escapeHtml(inv.invoice_number)}</span></li>
        </ul>
      </div>
    </section>

    <section class="signoff">
      <div class="left">Thank you for your business. For any clarification regarding this invoice, please reach <strong>${escapeHtml(COMPANY.email)}</strong>. This document is electronically certified and does not require a wet signature.</div>
      <div class="stamp">
        ${stamp ? `<img src="${stamp}" alt="Digital stamp" />` : ''}
        <div class="meta">Digitally signed · ${formatDate(new Date())}</div>
      </div>
    </section>

    <footer>
      <div class="l"><strong>${escapeHtml(COMPANY.name)}</strong> · ${escapeHtml(COMPANY.website)}</div>
      <div class="r"><span>TRN ${escapeHtml(COMPANY.trn)}</span><span>${escapeHtml(inv.invoice_number)}</span></div>
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
    const buf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    await page.close();
    pdfCache.set(key, buf);
    return buf;
  } catch (err) {
    // Fallback to raw html as buffer
    return Buffer.from(html, 'utf-8');
  }
}
