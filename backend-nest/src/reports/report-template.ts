import * as puppeteer from 'puppeteer';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ASSET_DIR = join(process.cwd(), 'assets');
let browserPromise: Promise<any> | null = null;

function logoDataUri(): string | null {
  const fp = join(ASSET_DIR, 'axistra-invoice-logo.png');
  if (!existsSync(fp)) return null;
  return `data:image/png;base64,${readFileSync(fp).toString('base64')}`;
}

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

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(n: any, digits = 2) {
  const v = parseFloat(n || 0);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-AE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface ReportPdfInput {
  title: string;
  subtitle?: string;
  /** Period or year label */
  period?: string;
  /** KPI tiles (label/value pairs) */
  kpis?: Array<{ label: string; value: string }>;
  /** Table columns + rows */
  columns?: string[];
  rows?: Array<Record<string, any>>;
  /** Footer text (legal/notes) */
  footer?: string;
}

export function renderReportHtml(input: ReportPdfInput): string {
  const logo = logoDataUri();
  const kpis = (input.kpis || []).map((k) => `
    <div class="kpi">
      <div class="k">${escapeHtml(k.label)}</div>
      <div class="v">${escapeHtml(k.value)}</div>
    </div>`).join('');
  const cols = input.columns || (input.rows && input.rows[0] ? Object.keys(input.rows[0]) : []);
  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = (input.rows || []).map((row) => `
    <tr>${cols.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return '<td>—</td>';
      if (typeof v === 'number') return `<td class="mono right">${fmt(v)}</td>`;
      const s = String(v);
      const isMono = /^[A-Z0-9-]{8,}$/.test(s) || /^0x[0-9a-fA-F]+/.test(s);
      return `<td class="${isMono ? 'mono small' : ''}">${escapeHtml(s)}</td>`;
    }).join('')}</tr>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title>
<style>
  @page { margin: 12mm 14mm 14mm; size: A4; }
  body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color:#0E1B17; margin:0; }
  header { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom: 10px; border-bottom: 2px solid #0A5C3E; }
  header .brand { display:flex; align-items:center; gap: 10px; }
  header img { height: 36px; }
  header .eyebrow { font-size:9px; letter-spacing:0.22em; color:#6B7B75; text-transform:uppercase; }
  header h1 { font-size: 18px; margin: 4px 0 0; font-weight: 700; color:#0A5C3E; }
  header .period { font-size: 10px; letter-spacing:0.16em; color:#36534a; text-transform:uppercase; }
  .subtitle { font-size: 10px; color:#4B5C56; margin-top: 8px; }
  .kpis { display:grid; grid-template-columns: repeat(${(input.kpis || []).length || 1}, 1fr); gap: 8px; margin: 14px 0 18px; }
  .kpi { border: 1px solid #E3E7E5; border-radius: 6px; padding: 10px 12px; background: linear-gradient(135deg, #F4F8F5 0%, #FFFFFF 100%); }
  .kpi .k { font-size: 8px; letter-spacing:0.2em; color:#6B7B75; text-transform:uppercase; }
  .kpi .v { font-size: 16px; font-weight: 700; color:#0A5C3E; margin-top: 4px; font-family: "JetBrains Mono", monospace; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; }
  thead th { background: #0A5C3E; color: white; padding: 6px 8px; text-align:left; font-size: 9px; letter-spacing:0.1em; text-transform:uppercase; font-weight: 600; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #EEF1EF; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #FAFBFA; }
  .mono { font-family: "JetBrains Mono", monospace; }
  .right { text-align: right; }
  .small { font-size: 9px; word-break: break-all; }
  footer.legal { margin-top: 18px; padding-top: 10px; border-top: 1px solid #E3E7E5; font-size: 9px; color: #6B7B75; line-height: 1.5; }
  .meta { display:flex; justify-content:space-between; font-size: 9px; color:#6B7B75; margin-top: 4px; }
</style></head>
<body>
  <header>
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="Axistra" />` : ''}
      <div>
        <div class="eyebrow">Axistra Technologies — FZCO</div>
        <h1>${escapeHtml(input.title)}</h1>
      </div>
    </div>
    <div class="period">${escapeHtml(input.period || new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }))}</div>
  </header>
  ${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ''}
  ${kpis ? `<div class="kpis">${kpis}</div>` : ''}
  ${cols.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#6B7B75;padding:18px;">No data</td></tr>'}</tbody></table>` : ''}
  <footer class="legal">
    ${escapeHtml(input.footer || 'Confidential — Generated by Axistra Compliance + Accounting Portal. TRN 105415374500001. License No. 86256.')}
    <div class="meta"><span>Page footer</span><span>Generated ${new Date().toISOString().slice(0, 10)}</span></div>
  </footer>
</body></html>`;
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const html = renderReportHtml(input);
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.close();
    return buf;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[renderReportPdf] puppeteer failed, returning HTML:', err);
    return Buffer.from(html, 'utf-8');
  }
}

export function renderCoverHtml(input: { title: string; subtitle?: string; items: Array<{ name: string; desc?: string }> }) {
  const logo = logoDataUri();
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { margin: 0; size: A4; }
    body { font-family:"Inter",Arial,sans-serif; color:#0E1B17; margin:0; }
    .page { width:210mm; height:297mm; position:relative; padding: 40mm 22mm; background:
      radial-gradient(circle at top right, rgba(212,175,55,0.12), transparent 38%),
      radial-gradient(circle at bottom left, rgba(10,92,62,0.16), transparent 32%),
      #ffffff; }
    .brand { display:flex; gap:14px; align-items:center; }
    .brand img { height: 50px; }
    .eyebrow { font-size:10px; letter-spacing:0.24em; color:#6B7B75; text-transform:uppercase; }
    .co { font-size:18px; font-weight:700; color:#0A5C3E; margin-top:4px; }
    h1 { font-family:"Inter",sans-serif; font-size: 48px; margin: 40mm 0 4mm; font-weight:700; color:#0E1B17; letter-spacing:-0.02em; }
    .sub { font-size: 14px; color:#36534a; max-width:140mm; }
    .gold { width: 80mm; height: 4px; background: linear-gradient(90deg, #C6A14B, transparent); margin: 14mm 0; }
    ul { padding-left: 0; list-style:none; }
    li { padding: 10px 0; border-bottom: 1px solid #E3E7E5; display:flex; justify-content:space-between; align-items:center; }
    li .name { font-weight:600; color:#0E1B17; font-size:13px; }
    li .desc { font-size:10px; color:#6B7B75; max-width: 90mm; }
    footer { position:absolute; bottom: 22mm; left: 22mm; right: 22mm; font-size:10px; color:#6B7B75; display:flex; justify-content:space-between; border-top:1px solid #E3E7E5; padding-top:8mm;}
  </style></head><body><div class="page">
    <div class="brand">${logo ? `<img src="${logo}"/>` : ''}<div><div class="eyebrow">Axistra Technologies — FZCO</div><div class="co">Compliance + Accounting Portal</div></div></div>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="sub">${escapeHtml(input.subtitle || '')}</div>
    <div class="gold"></div>
    <ul>${input.items.map((i) => `<li><span class="name">${escapeHtml(i.name)}</span><span class="desc">${escapeHtml(i.desc || '')}</span></li>`).join('')}</ul>
    <footer><span>TRN 105415374500001 · License 86256 · IFZA Dubai</span><span>Generated ${new Date().toLocaleString('en-GB')}</span></footer>
  </div></body></html>`;
}

export async function renderCoverPdf(input: { title: string; subtitle?: string; items: Array<{ name: string; desc?: string }> }): Promise<Buffer> {
  const html = renderCoverHtml(input);
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    await page.close();
    return buf;
  } catch (err) {
    return Buffer.from(html, 'utf-8');
  }
}
