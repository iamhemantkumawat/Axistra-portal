/**
 * Net Worth statement PDF — one-click CEO dashboard export.
 * Renders an Axistra-branded "Statement of Net Worth" with sections for:
 *   • Assets    (bank balances, crypto treasury, receivables)
 *   • Liabilities (open payroll, tax outstanding, expenses payable)
 *   • Net Worth (assets − liabilities)
 *   • Reconciliation health
 * The numbers are passed in as a pre-calculated snapshot — the service is
 * responsible for the math, this file only handles presentation.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

const ASSET_DIR = join(process.cwd(), 'assets');
let browserPromise: Promise<any> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pup = require('puppeteer');
    browserPromise = pup.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

function fileDataUri(name: string, mime = 'image/png'): string | null {
  const fp = join(ASSET_DIR, name);
  if (!existsSync(fp)) return null;
  return `data:${mime};base64,${readFileSync(fp).toString('base64')}`;
}

function esc(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function aed(n: any) {
  const v = Number(n) || 0;
  return `AED ${v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: any) {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export interface NetWorthLineItem {
  label: string;
  value_aed: number;
  detail?: string;
}

export interface NetWorthInput {
  as_of: Date;
  reference_number: string;
  assets: NetWorthLineItem[];
  liabilities: NetWorthLineItem[];
  reconciliation?: {
    pending_recharges: number;
    mismatches: number;
    open_invoices: number;
    drift_to_settle_aed: number;
  };
  ytd_revenue_aed?: number;
  ytd_expenses_aed?: number;
  director_name?: string;
  director_signature_b64?: string;
  company_seal_b64?: string;
  company_address?: string;
  company_trn?: string;
  company_license?: string;
  company_email?: string;
}

function styles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 40px 56px 80px; font-size: 12px; line-height: 1.55; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0E6B45; padding-bottom: 16px; margin-bottom: 24px; }
    .brand img { height: 60px; }
    .brand .name { font-size: 22px; font-weight: 700; color: #0E6B45; letter-spacing: 0.4px; }
    .brand .sub { font-size: 9px; letter-spacing: 0.22em; color: #C09A2F; text-transform: uppercase; margin-top: 3px; }
    .meta { text-align: right; font-size: 10px; color: #555; }
    h1.title { text-align: center; font-size: 18px; letter-spacing: 4px; text-transform: uppercase; font-weight: 700; margin: 18px 0 6px; }
    .as-of { text-align: center; font-size: 11px; color: #555; margin-bottom: 22px; }
    .summary { display: flex; gap: 14px; margin: 20px 0 26px; }
    .kpi { flex: 1; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 14px; background: #fafafa; }
    .kpi.green { background: #ECF7F1; border-color: #0E6B45; }
    .kpi.green .val { color: #0E6B45; }
    .kpi .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #666; margin-bottom: 4px; }
    .kpi .val { font-size: 17px; font-weight: 700; color: #111; }
    h2.sec { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: #0E6B45; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d6d6d6; }
    table.ledger { width: 100%; border-collapse: collapse; }
    table.ledger th { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: #555; text-align: left; padding: 7px 8px; background: #f6f6f6; border-bottom: 1px solid #e0e0e0; }
    table.ledger td { font-size: 11px; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
    table.ledger td.right { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    table.ledger tr.total td { font-weight: 700; background: #fcfcfa; border-top: 1px solid #aaa; }
    .net-worth-row { background: #0E6B45 !important; color: #fff !important; }
    .net-worth-row td { color: #fff !important; font-size: 13px !important; padding: 12px 8px !important; }
    .reconc { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 26px; }
    .reconc .chip { border: 1px solid #e5e5e5; border-radius: 6px; padding: 9px 10px; text-align: center; }
    .reconc .chip .n { font-size: 16px; font-weight: 700; color: #0E6B45; }
    .reconc .chip .n.warn { color: #b45309; }
    .reconc .chip .n.bad { color: #b91c1c; }
    .reconc .chip .l { font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #555; margin-top: 4px; }
    .sig { margin-top: 40px; display: flex; align-items: flex-end; gap: 48px; }
    .sig-col img.sig-img { max-height: 64px; max-width: 200px; display: block; }
    .sig-col .line { border-top: 1px solid #333; margin-top: 6px; width: 75%; }
    .sig-col .n { font-weight: 700; margin-top: 3px; font-size: 12px; }
    .sig-col .r { color: #666; font-size: 10px; }
    .sig-col .c { color: #0E6B45; font-size: 10px; font-weight: 600; margin-top: 2px; }
    .seal img { max-height: 100px; opacity: 0.92; }
    .footer { position: fixed; bottom: 22px; left: 56px; right: 56px; font-size: 9px; color: #777; border-top: 1px solid #eee; padding-top: 6px; display: flex; justify-content: space-between; }
    .note { font-size: 9px; color: #777; font-style: italic; margin-top: 8px; }
  `;
}

function lineItemRow(item: NetWorthLineItem) {
  return `
    <tr>
      <td>${esc(item.label)}${item.detail ? `<div style="font-size:9px;color:#777;margin-top:2px">${esc(item.detail)}</div>` : ''}</td>
      <td class="right">${aed(item.value_aed)}</td>
    </tr>
  `;
}

export async function renderNetWorthPdf(input: NetWorthInput): Promise<Buffer> {
  const logo = fileDataUri('axistra-landscape.png') || fileDataUri('axistra-invoice-logo.png');
  const totalAssets = input.assets.reduce((s, l) => s + (l.value_aed || 0), 0);
  const totalLiabilities = input.liabilities.reduce((s, l) => s + (l.value_aed || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const sig = input.director_signature_b64
    ? `<img src="data:image/png;base64,${input.director_signature_b64}" class="sig-img" />`
    : '';
  const seal = input.company_seal_b64
    ? `<img src="data:image/png;base64,${input.company_seal_b64}" />`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${styles()}</style></head><body>
    <div class="header">
      <div class="brand">
        ${logo ? `<img src="${logo}" />` : `<div class="name">AXISTRA TECHNOLOGIES</div><div class="sub">Innovate · Connect · Grow</div>`}
      </div>
      <div class="meta">
        ${esc(input.company_address || 'IFZA Business Park, Dubai, UAE')}<br/>
        TRN: ${esc(input.company_trn || '105415374500001')} · License ${esc(input.company_license || '86256')}<br/>
        ${esc(input.company_email || 'admin@axistratech.com')}
      </div>
    </div>

    <h1 class="title">Statement of Net Worth</h1>
    <div class="as-of">As of <strong>${fmtDate(input.as_of)}</strong> · Reference ${esc(input.reference_number)}</div>

    <div class="summary">
      <div class="kpi"><div class="lbl">Total Assets</div><div class="val">${aed(totalAssets)}</div></div>
      <div class="kpi"><div class="lbl">Total Liabilities</div><div class="val">${aed(totalLiabilities)}</div></div>
      <div class="kpi green"><div class="lbl">Net Worth</div><div class="val">${aed(netWorth)}</div></div>
    </div>

    <h2 class="sec">Assets</h2>
    <table class="ledger">
      <thead><tr><th>Item</th><th style="text-align:right">Value (AED)</th></tr></thead>
      <tbody>
        ${input.assets.length === 0 ? '<tr><td colspan="2" style="text-align:center;color:#888;padding:14px">No assets recorded.</td></tr>' : input.assets.map(lineItemRow).join('')}
        <tr class="total"><td>Total Assets</td><td class="right">${aed(totalAssets)}</td></tr>
      </tbody>
    </table>

    <h2 class="sec">Liabilities</h2>
    <table class="ledger">
      <thead><tr><th>Item</th><th style="text-align:right">Value (AED)</th></tr></thead>
      <tbody>
        ${input.liabilities.length === 0 ? '<tr><td colspan="2" style="text-align:center;color:#888;padding:14px">No outstanding liabilities.</td></tr>' : input.liabilities.map(lineItemRow).join('')}
        <tr class="total"><td>Total Liabilities</td><td class="right">${aed(totalLiabilities)}</td></tr>
      </tbody>
    </table>

    <h2 class="sec">Net Position</h2>
    <table class="ledger">
      <tbody>
        <tr class="net-worth-row">
          <td><strong>NET WORTH</strong> (Assets − Liabilities)</td>
          <td class="right">${aed(netWorth)}</td>
        </tr>
      </tbody>
    </table>

    ${input.reconciliation ? `
      <h2 class="sec">Reconciliation Health</h2>
      <div class="reconc">
        <div class="chip"><div class="n ${input.reconciliation.pending_recharges > 0 ? 'warn' : ''}">${input.reconciliation.pending_recharges}</div><div class="l">Pending Recharges</div></div>
        <div class="chip"><div class="n ${input.reconciliation.mismatches > 0 ? 'bad' : ''}">${input.reconciliation.mismatches}</div><div class="l">Mismatches</div></div>
        <div class="chip"><div class="n">${input.reconciliation.open_invoices}</div><div class="l">Open Invoices</div></div>
        <div class="chip"><div class="n ${input.reconciliation.drift_to_settle_aed > 0 ? 'warn' : ''}">${aed(input.reconciliation.drift_to_settle_aed)}</div><div class="l">Exchange Drift</div></div>
      </div>
    ` : ''}

    ${(input.ytd_revenue_aed != null || input.ytd_expenses_aed != null) ? `
      <h2 class="sec">Year-to-Date Performance</h2>
      <table class="ledger">
        <tbody>
          <tr><td>Revenue YTD (FX-converted to AED)</td><td class="right">${aed(input.ytd_revenue_aed || 0)}</td></tr>
          <tr><td>Expenses YTD</td><td class="right">${aed(input.ytd_expenses_aed || 0)}</td></tr>
          <tr class="total"><td>Gross Profit YTD</td><td class="right">${aed((input.ytd_revenue_aed || 0) - (input.ytd_expenses_aed || 0))}</td></tr>
        </tbody>
      </table>
    ` : ''}

    <div class="note">
      This statement is generated from the Axistra Compliance + Accounting Portal at the time and date shown above. All non-AED balances are converted at live FX rates. Crypto holdings are valued at the most recent treasury batch conversion rate. This document represents internal management accounts and is not an audit report.
    </div>

    <div class="sig">
      <div class="sig-col">
        ${sig}
        <div class="line"></div>
        <div class="n">${esc(input.director_name || 'Hemant Kumawat')}</div>
        <div class="r">Director</div>
        <div class="c">AXISTRA TECHNOLOGIES — FZCO</div>
      </div>
      ${seal ? `<div class="seal">${seal}</div>` : ''}
    </div>

    <div class="footer">
      <span>AXISTRA TECHNOLOGIES — FZCO · Confidential</span>
      <span>Generated by Axistra Compliance Portal · ${fmtDate(new Date())}</span>
    </div>
  </body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '18mm', left: '12mm', right: '12mm' } });
  } finally {
    await page.close();
  }
}
