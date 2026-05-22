import { Invoice } from '../entities/invoice.entity';

const COMPANY = {
  name: 'AXISTRA TECHNOLOGIES - FZCO',
  tagline: 'Innovate • Connect • Grow',
  trn: '105415374500001',
  registration: 'IFZA Free Zone, Dubai, United Arab Emirates',
  service: 'SaaS Platform Usage Credits',
};

export function renderInvoiceHtml(inv: Invoice): string {
  const date = inv.issued_date ? new Date(inv.issued_date) : new Date(inv.created_at);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const amount = parseFloat(inv.amount).toFixed(2);
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Invoice ${inv.invoice_number}</title>
<style>
  @page { margin: 24mm 18mm; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; color: #111827; font-size: 12px; }
  .header { display: flex; justify-content: space-between; border-bottom: 3px solid #0A5C3E; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { color: #0A5C3E; font-size: 28px; font-weight: 700; letter-spacing: 1px; }
  .brand .gold { color: #D4AF37; }
  .tagline { color: #6B7280; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
  .meta { text-align: right; font-size: 12px; }
  .meta .label { color: #6B7280; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; }
  .section-title { color: #0A5C3E; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 6px; }
  .row { display: flex; justify-content: space-between; gap: 24px; margin: 18px 0; }
  .col { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  thead { background: #0A5C3E; color: #fff; }
  th, td { padding: 12px; text-align: left; }
  tbody tr { border-bottom: 1px solid #E5E7EB; }
  .totals { width: 320px; margin-left: auto; margin-top: 24px; }
  .totals .line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #E5E7EB; font-size: 12px; }
  .totals .grand { background: #0A5C3E; color: #fff; padding: 14px; border-radius: 4px; display: flex; justify-content: space-between; font-size: 16px; margin-top: 8px; }
  .crypto-box { background: #fbf7e9; border: 1px solid #D4AF37; border-radius: 4px; padding: 14px; margin-top: 18px; font-size: 11px; }
  .crypto-box .label { color: #6B7280; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; margin-bottom: 2px; }
  .crypto-box code { font-family: 'Courier New', monospace; word-break: break-all; }
  .footer { margin-top: 50px; padding-top: 16px; border-top: 2px solid #0A5C3E; font-size: 10px; color: #4B5563; line-height: 1.6; }
  .footer strong { color: #0A5C3E; }
</style></head>
<body>
  <div class="header">
    <div>
      <div class="brand">AXIS<span class="gold">T</span>RA</div>
      <div class="tagline">Technologies — ${COMPANY.tagline}</div>
    </div>
    <div class="meta">
      <div class="label">Invoice</div>
      <div style="font-size: 20px; font-weight: 700; color: #0A5C3E;">${inv.invoice_number}</div>
      <div style="margin-top: 8px;"><span class="label">Date:</span> ${fmt(date)}</div>
      <div><span class="label">Status:</span> ${(inv.status || 'unpaid').toUpperCase()}</div>
    </div>
  </div>

  <div class="row">
    <div class="col">
      <div class="section-title">Billed To</div>
      <div style="font-weight: 600; font-size: 14px;">${inv.customer_name || ''}</div>
      ${inv.customer_company ? `<div>${inv.customer_company}</div>` : ''}
      ${inv.customer_email ? `<div style="color:#4B5563;">${inv.customer_email}</div>` : ''}
      ${inv.customer_country ? `<div style="color:#4B5563;">${inv.customer_country}</div>` : ''}
    </div>
    <div class="col" style="text-align: right;">
      <div class="section-title">From</div>
      <div style="font-weight: 600;">${COMPANY.name}</div>
      <div style="color:#4B5563;">${COMPANY.registration}</div>
      <div style="color:#4B5563;">TRN: ${COMPANY.trn}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th style="width: 56%;">Service</th><th>Description</th><th style="text-align:right;">Amount</th></tr>
    </thead>
    <tbody>
      <tr>
        <td style="font-weight: 600;">${inv.service_name || COMPANY.service}</td>
        <td style="color:#4B5563;">${inv.service_description || 'Prepaid credits for usage of Axistra cloud software platform and related digital services.'}</td>
        <td style="text-align:right; font-weight:600;">${inv.currency} ${amount}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="line"><span>Subtotal</span><span>${inv.currency} ${amount}</span></div>
    <div class="line"><span>VAT (0% — Out of scope)</span><span>${inv.currency} 0.00</span></div>
    <div class="grand"><span>TOTAL</span><span>${inv.currency} ${amount}</span></div>
  </div>

  ${inv.tx_hash || inv.payment_method ? `
  <div class="crypto-box">
    <div class="section-title" style="margin-bottom: 8px;">Payment Details</div>
    ${inv.payment_method ? `<div><span class="label">Method:</span> ${inv.payment_method}</div>` : ''}
    ${inv.crypto_coin ? `<div><span class="label">Coin/Network:</span> ${inv.crypto_coin} / ${inv.crypto_network || ''}</div>` : ''}
    ${inv.tx_hash ? `<div style="margin-top: 6px;"><div class="label">Transaction Hash</div><code>${inv.tx_hash}</code></div>` : ''}
  </div>` : ''}

  <div class="footer">
    <strong>${COMPANY.name}</strong><br/>
    IFZA / Dubai Integrated Economic Zones Authority<br/>
    Dubai Silicon Oasis, Dubai, United Arab Emirates<br/>
    Corporate Tax Registration No: ${COMPANY.trn}<br/>
    Service: ${COMPANY.service} — ${COMPANY.tagline}
  </div>
</body></html>`;
}

export async function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  const html = renderInvoiceHtml(inv);
  try {
    // Lazy-load puppeteer so service starts even if Chromium is missing
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await browser.close();
    return Buffer.from(pdf);
  } catch (e) {
    // Fallback: return HTML as buffer so client can still preview/save
    return Buffer.from(html, 'utf-8');
  }
}
