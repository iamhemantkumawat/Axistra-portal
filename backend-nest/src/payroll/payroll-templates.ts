/**
 * Payroll-related PDF generators: Offer Letter, Board Resolution, Salary Slip.
 * All share the same Puppeteer browser singleton + branding lookups so we
 * keep a single Chrome instance hot across the app.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

function fmtAed(n: any) {
  const v = parseFloat(n || 0);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: any) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export interface Branding {
  director_name?: string;       // "Hemant Kumawat"
  director_signature?: string;  // base64 PNG (data URI ready) — without prefix
  company_seal?: string;        // base64 PNG
  company_address?: string;
  company_trn?: string;
  company_license?: string;
  company_email?: string;
}

const DEFAULT_BRANDING: Branding = {
  director_name: 'Hemant Kumawat',
  company_address: 'IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai, UAE',
  company_trn: '105415374500001',
  company_license: '86256',
  company_email: 'admin@axistratech.com',
};

function signatureBlock(branding: Branding) {
  const sig = branding.director_signature
    ? `<img src="data:image/png;base64,${branding.director_signature}" alt="Signature" class="sig-img" />`
    : '<div class="sig-placeholder">—</div>';
  const seal = branding.company_seal
    ? `<img src="data:image/png;base64,${branding.company_seal}" alt="Seal" class="seal-img" />`
    : '';
  return `
    <div class="signature-block">
      <div class="sig-col">
        ${sig}
        <div class="sig-line"></div>
        <div class="sig-name">${esc(branding.director_name || 'Hemant Kumawat')}</div>
        <div class="sig-role">Director</div>
        <div class="sig-company">AXISTRA TECHNOLOGIES — FZCO</div>
      </div>
      ${seal ? `<div class="seal-col">${seal}</div>` : ''}
    </div>
  `;
}

function commonStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 48px 56px; font-size: 12px; line-height: 1.6; }
    .doc-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0E6B45; padding-bottom: 18px; margin-bottom: 28px; }
    .doc-header .brand-name { font-size: 22px; font-weight: 700; color: #0E6B45; letter-spacing: 0.5px; }
    .doc-header .brand-sub { font-size: 9px; letter-spacing: 0.22em; color: #C09A2F; text-transform: uppercase; margin-top: 2px; }
    .doc-header img.logo { height: 56px; }
    .doc-meta { font-size: 10px; color: #555; text-align: right; }
    h1.doc-title { font-size: 18px; text-align: center; margin: 26px 0 18px; letter-spacing: 4px; text-transform: uppercase; font-weight: 700; }
    .lede { margin-bottom: 14px; }
    table.kv { width: 100%; border-collapse: collapse; margin: 18px 0; }
    table.kv td { padding: 8px 10px; border-bottom: 1px solid #eaeaea; }
    table.kv td.k { width: 35%; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    table.kv td.v { font-weight: 600; }
    p { margin: 10px 0; }
    .signature-block { margin-top: 60px; display: flex; align-items: flex-end; gap: 64px; }
    .sig-col { flex: 1; }
    .sig-img { max-height: 70px; max-width: 200px; object-fit: contain; display: block; }
    .sig-placeholder { height: 50px; }
    .sig-line { border-top: 1px solid #333; margin-top: 6px; width: 70%; }
    .sig-name { font-weight: 700; margin-top: 4px; font-size: 13px; }
    .sig-role { color: #666; font-size: 11px; }
    .sig-company { color: #0E6B45; font-size: 10px; font-weight: 600; margin-top: 2px; }
    .seal-col img.seal-img { max-height: 110px; opacity: 0.92; }
    .footer { position: fixed; bottom: 26px; left: 56px; right: 56px; font-size: 9px; color: #777; border-top: 1px solid #eee; padding-top: 8px; display: flex; justify-content: space-between; }
    .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; background: #ECF7F1; color: #0E6B45; font-weight: 600; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
  `;
}

function headerBlock(branding: Branding) {
  const logo = fileDataUri('axistra-landscape.png') || fileDataUri('axistra-invoice-logo.png');
  return `
    <div class="doc-header">
      <div>
        ${logo ? `<img class="logo" src="${logo}" />` : `<div class="brand-name">AXISTRA TECHNOLOGIES</div><div class="brand-sub">Innovate · Connect · Grow</div>`}
      </div>
      <div class="doc-meta">
        ${esc(branding.company_address || '')}<br/>
        TRN: ${esc(branding.company_trn || '')} · License ${esc(branding.company_license || '')}<br/>
        ${esc(branding.company_email || '')}
      </div>
    </div>
  `;
}

function footerBlock() {
  return `<div class="footer"><span>AXISTRA TECHNOLOGIES — FZCO</span><span>Generated by Axistra Compliance Portal</span></div>`;
}

async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '18mm', left: '12mm', right: '12mm' } });
  } finally {
    await page.close();
  }
}

// ---------- Offer Letter ----------

export interface OfferLetterInput {
  employee_name: string;
  position: string;
  monthly_salary: number | string;
  currency: string;
  start_date: any;
  letter_date?: any;
  employer?: string;
}

export async function renderOfferLetterPdf(input: OfferLetterInput, branding?: Branding): Promise<Buffer> {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const issued = fmtDate(input.letter_date || new Date());
  const start = fmtDate(input.start_date);
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>${commonStyles()}</style></head>
  <body>
    ${headerBlock(b)}
    <div style="text-align:right; font-size: 10px; color: #555;">Ref: AXISTRA/HR/${new Date(input.letter_date || Date.now()).getFullYear()}/${String(input.employee_name).split(' ').map(p => p[0]).join('').toUpperCase()}</div>
    <h1 class="doc-title">Offer of Employment</h1>
    <p>${issued}</p>
    <p><strong>${esc(input.employee_name)}</strong></p>

    <p>Dear ${esc(input.employee_name.split(' ')[0])},</p>
    <p>We are delighted to extend an offer of employment with <strong>${esc(input.employer || 'AXISTRA TECHNOLOGIES — FZCO')}</strong>. The terms of this offer are summarised below and shall be governed by the laws of the United Arab Emirates and the regulations of the Dubai Integrated Economic Zones Authority (IFZA).</p>

    <table class="kv">
      <tr><td class="k">Position</td><td class="v">${esc(input.position)}</td></tr>
      <tr><td class="k">Employer</td><td class="v">${esc(input.employer || 'AXISTRA TECHNOLOGIES — FZCO')}</td></tr>
      <tr><td class="k">Start Date</td><td class="v">${start}</td></tr>
      <tr><td class="k">Monthly Salary</td><td class="v">${esc(input.currency)} ${fmtAed(input.monthly_salary)}</td></tr>
      <tr><td class="k">Payment Schedule</td><td class="v">Monthly, paid by bank transfer within 7 working days of period end</td></tr>
      <tr><td class="k">Place of Work</td><td class="v">Dubai Silicon Oasis, UAE (hybrid permitted)</td></tr>
    </table>

    <p>Your employment shall be subject to the company handbook, including confidentiality, IP-assignment, and anti-bribery undertakings, which form part of this agreement.</p>
    <p>Please countersign this letter to confirm acceptance. We look forward to your contribution to Axistra.</p>

    <p>Yours sincerely,</p>
    ${signatureBlock(b)}

    <div style="margin-top:80px; border-top:1px dashed #aaa; padding-top:16px;">
      <p style="font-size:11px;">Accepted &amp; agreed:</p>
      <div style="margin-top:40px; width: 60%; border-top:1px solid #333;"></div>
      <p style="font-size:11px; margin-top:6px;">${esc(input.employee_name)} &nbsp;·&nbsp; Date: ____________________</p>
    </div>

    ${footerBlock()}
  </body></html>`;
  return htmlToPdf(html);
}

// ---------- Board Resolution ----------

export interface BoardResolutionInput {
  effective_date: any;
  resolution_date?: any;
  rows: Array<{ employee_name: string; position: string; monthly_salary: number | string; currency: string }>;
  resolution_number?: string;
}

export async function renderBoardResolutionPdf(input: BoardResolutionInput, branding?: Branding): Promise<Buffer> {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const resDate = fmtDate(input.resolution_date || new Date());
  const eff = fmtDate(input.effective_date);
  const lines = input.rows.map((r) => `
    <tr>
      <td>${esc(r.employee_name)}</td>
      <td>${esc(r.position)}</td>
      <td style="text-align:right;"><strong>${esc(r.currency)} ${fmtAed(r.monthly_salary)}</strong></td>
    </tr>`).join('');

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    ${commonStyles()}
    table.resolution { width:100%; border-collapse: collapse; margin: 18px 0; }
    table.resolution th, table.resolution td { padding: 10px 12px; border-bottom: 1px solid #ddd; font-size: 11px; }
    table.resolution th { background: #F4FBF7; color: #0E6B45; text-align: left; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; }
  </style></head>
  <body>
    ${headerBlock(b)}
    <div style="text-align:right; font-size:10px; color:#555;">Resolution No: ${esc(input.resolution_number || `AXR-${new Date(input.resolution_date || Date.now()).getFullYear()}-001`)}</div>
    <h1 class="doc-title">Board Resolution</h1>
    <p style="text-align:center; color:#666;">AXISTRA TECHNOLOGIES — FZCO &nbsp;·&nbsp; Dated ${resDate}</p>

    <p><strong>RESOLVED THAT</strong> the following monthly salaries are hereby approved by the Board of Directors of AXISTRA TECHNOLOGIES — FZCO with effect from <strong>${eff}</strong>:</p>

    <table class="resolution">
      <thead><tr><th>Employee</th><th>Position</th><th style="text-align:right;">Monthly Salary</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>

    <p><strong>FURTHER RESOLVED THAT</strong> the Director is authorised to instruct the company's banker(s) to disburse the above salaries on the customary pay date of each month, and to execute any documents required to give effect to this resolution.</p>
    <p><strong>FURTHER RESOLVED THAT</strong> this resolution shall remain in force until amended or rescinded by a subsequent resolution of the Board.</p>

    <p style="margin-top:30px;">Approved by:</p>
    ${signatureBlock(b)}
    ${footerBlock()}
  </body></html>`;
  return htmlToPdf(html);
}

// ---------- Salary Slip ----------

export interface SalarySlipInput {
  employee_name: string;
  employee_code?: string;
  position: string;
  period_label: string;     // "May 2026"
  paid_at: any;
  basic_salary: number | string;
  allowances?: number | string;
  deductions?: number | string;
  net_salary: number | string;
  currency: string;
  bank_name?: string;
  bank_iban?: string;
  transfer_reference?: string;
}

export async function renderSalarySlipPdf(input: SalarySlipInput, branding?: Branding): Promise<Buffer> {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const allowances = parseFloat(String(input.allowances || 0)) || 0;
  const deductions = parseFloat(String(input.deductions || 0)) || 0;
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    ${commonStyles()}
    table.slip { width:100%; border-collapse: collapse; margin: 20px 0; }
    table.slip td { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #eee; }
    table.slip td.lbl { background: #FAFBFA; color: #555; width: 50%; }
    table.slip td.amt { text-align:right; font-family: 'Menlo', monospace; font-weight: 600; }
    .net-row td { background: #0E6B45 !important; color:white !important; font-size: 14px !important; }
    .badge-paid { float:right; display:inline-block; padding:5px 12px; border-radius:999px; background:#0E6B45; color:white; font-size:11px; letter-spacing:0.1em; text-transform:uppercase; }
  </style></head>
  <body>
    ${headerBlock(b)}
    <h1 class="doc-title">Salary Slip — ${esc(input.period_label)}<span class="badge-paid">PAID</span></h1>

    <table class="kv">
      <tr><td class="k">Employee</td><td class="v">${esc(input.employee_name)}${input.employee_code ? ` · <span style="color:#888; font-weight:400;">${esc(input.employee_code)}</span>` : ''}</td></tr>
      <tr><td class="k">Position</td><td class="v">${esc(input.position)}</td></tr>
      <tr><td class="k">Pay Period</td><td class="v">${esc(input.period_label)}</td></tr>
      <tr><td class="k">Payment Date</td><td class="v">${fmtDate(input.paid_at)}</td></tr>
      ${input.bank_name ? `<tr><td class="k">Bank</td><td class="v">${esc(input.bank_name)}</td></tr>` : ''}
      ${input.bank_iban ? `<tr><td class="k">IBAN</td><td class="v" style="font-family:Menlo,monospace;">${esc(input.bank_iban)}</td></tr>` : ''}
      ${input.transfer_reference ? `<tr><td class="k">Reference</td><td class="v">${esc(input.transfer_reference)}</td></tr>` : ''}
    </table>

    <h3 style="margin-top:24px; color:#0E6B45;">Earnings &amp; Deductions</h3>
    <table class="slip">
      <tr><td class="lbl">Basic Salary</td><td class="amt">${esc(input.currency)} ${fmtAed(input.basic_salary)}</td></tr>
      ${allowances ? `<tr><td class="lbl">Allowances</td><td class="amt">+ ${esc(input.currency)} ${fmtAed(allowances)}</td></tr>` : ''}
      ${deductions ? `<tr><td class="lbl">Deductions</td><td class="amt">− ${esc(input.currency)} ${fmtAed(deductions)}</td></tr>` : ''}
      <tr class="net-row"><td class="lbl">NET SALARY</td><td class="amt">${esc(input.currency)} ${fmtAed(input.net_salary)}</td></tr>
    </table>

    <p style="font-size:10px; color:#777; margin-top:30px;">This salary slip is electronically generated by the Axistra Compliance + Accounting Portal and is valid without a handwritten signature. For verification, contact ${esc(b.company_email || '')}.</p>

    ${signatureBlock(b)}
    ${footerBlock()}
  </body></html>`;
  return htmlToPdf(html);
}

// ---------- Salary Revision Letter ----------

export interface SalaryRevisionInput {
  employee_name: string;
  employee_code?: string;
  position: string;
  old_salary: number | string;
  new_salary: number | string;
  currency: string;
  effective_date: any;
  letter_date?: any;
  reference_number?: string;
  original_offer_date?: any;
  reason?: string;
  acceptance?: AcceptanceStamp;
}

export interface AcceptanceStamp {
  status: 'agreed' | 'declined';
  employee_signature?: string; // typed name OR base64 PNG of drawn signature
  signature_method?: 'typed' | 'drawn';
  signed_at?: any;
  sign_ip?: string;
  decline_note?: string;
}

export async function renderSalaryRevisionPdf(input: SalaryRevisionInput, branding?: Branding): Promise<Buffer> {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const issued = fmtDate(input.letter_date || new Date());
  const eff = fmtDate(input.effective_date);
  const orig = input.original_offer_date ? fmtDate(input.original_offer_date) : null;
  const ref = input.reference_number || `AXR-SAL-${new Date(input.letter_date || Date.now()).getFullYear()}-001`;
  const delta = parseFloat(String(input.new_salary)) - parseFloat(String(input.old_salary));
  const pct = parseFloat(String(input.old_salary)) > 0
    ? (delta / parseFloat(String(input.old_salary))) * 100 : null;

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    ${commonStyles()}
    .deltabox { background:#F4FBF7; border:1px solid #C2E7D2; border-radius:6px; padding:14px 18px; margin: 18px 0; display:flex; gap:32px; flex-wrap:wrap; }
    .deltabox .lbl { font-size:10px; color:#0E6B45; letter-spacing:0.12em; text-transform:uppercase; }
    .deltabox .val { font-weight:700; font-size:16px; margin-top:2px; color:#0E6B45; font-family: 'Menlo', monospace; }
    .deltabox .delta { color: ${delta >= 0 ? '#0E6B45' : '#a32020'}; }
  </style></head>
  <body>
    ${headerBlock(b)}
    <div style="text-align:right; font-size:10px; color:#555;">Ref: ${esc(ref)}</div>
    <h1 class="doc-title">Salary Revision Letter</h1>
    <p>${issued}</p>
    <p><strong>${esc(input.employee_name)}</strong>${input.employee_code ? ` &nbsp;·&nbsp; <span style="color:#888">${esc(input.employee_code)}</span>` : ''}<br/>${esc(input.position)}</p>

    <p>Dear ${esc(input.employee_name.split(' ')[0])},</p>
    <p>
      Further to ${orig ? `your offer letter dated ${orig}` : 'your existing employment with the Company'}, and pursuant to the Board Resolution dated ${issued},
      we are pleased to confirm that the Board of Directors of <strong>AXISTRA TECHNOLOGIES — FZCO</strong> has approved a revision of your monthly salary as detailed below, with effect from <strong>${eff}</strong>.
    </p>

    <div class="deltabox">
      <div><div class="lbl">Previous Salary</div><div class="val">${esc(input.currency)} ${fmtAed(input.old_salary)}</div></div>
      <div><div class="lbl">Revised Salary</div><div class="val">${esc(input.currency)} ${fmtAed(input.new_salary)}</div></div>
      <div><div class="lbl">Change</div><div class="val delta">${delta >= 0 ? '+' : ''}${esc(input.currency)} ${fmtAed(Math.abs(delta))}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</div></div>
      <div><div class="lbl">Effective</div><div class="val">${eff}</div></div>
    </div>

    ${input.reason ? `<p><strong>Reason:</strong> ${esc(input.reason)}</p>` : ''}
    <p>All other terms and conditions of your employment shall remain unchanged. The revised salary supersedes any prior salary terms with effect from the date stated above.</p>
    <p>Please countersign this letter (electronically via the link sent to you, or in writing) to confirm your acceptance of the revised terms.</p>

    <p style="margin-top:24px;">For and on behalf of <strong>AXISTRA TECHNOLOGIES — FZCO</strong>,</p>
    ${signatureBlock(b)}

    ${renderAcceptanceBlock(input.employee_name, input.acceptance)}
    ${footerBlock()}
  </body></html>`;
  return htmlToPdf(html);
}

// ---------- Position Change Letter ----------

export interface PositionChangeInput {
  employee_name: string;
  employee_code?: string;
  old_position: string;
  new_position: string;
  effective_date: any;
  letter_date?: any;
  reference_number?: string;
  reason?: string;
  acceptance?: AcceptanceStamp;
}

export async function renderPositionChangePdf(input: PositionChangeInput, branding?: Branding): Promise<Buffer> {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const issued = fmtDate(input.letter_date || new Date());
  const eff = fmtDate(input.effective_date);
  const ref = input.reference_number || `AXR-POS-${new Date(input.letter_date || Date.now()).getFullYear()}-001`;

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    ${commonStyles()}
    .deltabox { background:#FFF7E5; border:1px solid #F2D89D; border-radius:6px; padding:14px 18px; margin: 18px 0; display:flex; gap:32px; flex-wrap:wrap; }
    .deltabox .lbl { font-size:10px; color:#A47200; letter-spacing:0.12em; text-transform:uppercase; }
    .deltabox .val { font-weight:700; font-size:14px; margin-top:2px; color:#222; }
  </style></head>
  <body>
    ${headerBlock(b)}
    <div style="text-align:right; font-size:10px; color:#555;">Ref: ${esc(ref)}</div>
    <h1 class="doc-title">Position Change Letter</h1>
    <p>${issued}</p>
    <p><strong>${esc(input.employee_name)}</strong>${input.employee_code ? ` &nbsp;·&nbsp; <span style="color:#888">${esc(input.employee_code)}</span>` : ''}</p>

    <p>Dear ${esc(input.employee_name.split(' ')[0])},</p>
    <p>
      We are pleased to confirm that the Board of Directors of <strong>AXISTRA TECHNOLOGIES — FZCO</strong> has approved a change in your position within the Company, effective from <strong>${eff}</strong>.
    </p>

    <div class="deltabox">
      <div><div class="lbl">Previous Position</div><div class="val">${esc(input.old_position)}</div></div>
      <div><div class="lbl">New Position</div><div class="val">${esc(input.new_position)}</div></div>
      <div><div class="lbl">Effective</div><div class="val">${eff}</div></div>
    </div>

    ${input.reason ? `<p><strong>Reason:</strong> ${esc(input.reason)}</p>` : ''}
    <p>All other terms and conditions of your employment shall remain unchanged unless varied by a separate written agreement.</p>
    <p>Please countersign this letter (electronically via the link sent to you, or in writing) to confirm your acceptance of the revised position.</p>

    <p style="margin-top:24px;">For and on behalf of <strong>AXISTRA TECHNOLOGIES — FZCO</strong>,</p>
    ${signatureBlock(b)}

    ${renderAcceptanceBlock(input.employee_name, input.acceptance)}
    ${footerBlock()}
  </body></html>`;
  return htmlToPdf(html);
}

function renderAcceptanceBlock(employeeName: string, acceptance?: AcceptanceStamp) {
  if (!acceptance) {
    return `
      <div style="margin-top:60px; border-top:1px dashed #aaa; padding-top:16px;">
        <p style="font-size:11px;"><strong>Employee acceptance:</strong> Pending — please sign via the link sent to you, or below in writing.</p>
        <div style="margin-top:40px; width: 60%; border-top:1px solid #333;"></div>
        <p style="font-size:11px; margin-top:6px;">${esc(employeeName)} &nbsp;·&nbsp; Date: ____________________</p>
      </div>`;
  }
  if (acceptance.status === 'declined') {
    return `
      <div style="margin-top:50px; border-top:1px dashed #a32020; padding-top:14px;">
        <p style="font-size:11px; color:#a32020;"><strong>Status: DECLINED</strong> · ${esc(fmtDate(acceptance.signed_at || new Date()))} · IP ${esc(acceptance.sign_ip || '—')}</p>
        ${acceptance.decline_note ? `<p style="font-size:11px;">${esc(acceptance.decline_note)}</p>` : ''}
        <p style="font-size:11px; margin-top:6px;">${esc(employeeName)}</p>
      </div>`;
  }
  const sigBlock = acceptance.signature_method === 'drawn' && acceptance.employee_signature
    ? `<img src="data:image/png;base64,${acceptance.employee_signature}" alt="Employee signature" style="max-height:60px; max-width:240px; display:block;" />`
    : `<div style="font-family: 'Brush Script MT','Pinyon Script', cursive; font-size: 26px; color:#0E6B45;">${esc(acceptance.employee_signature || employeeName)}</div>`;
  return `
    <div style="margin-top:50px; border-top:1px dashed #0E6B45; padding-top:14px;">
      <p style="font-size:11px; color:#0E6B45;"><strong>Status: AGREED</strong> · Signed electronically ${esc(fmtDate(acceptance.signed_at || new Date()))} ${acceptance.sign_ip ? `· IP ${esc(acceptance.sign_ip)}` : ''}</p>
      ${sigBlock}
      <div style="border-top:1px solid #333; width:60%; margin-top:4px;"></div>
      <p style="font-size:11px; margin-top:6px;">${esc(employeeName)} &nbsp;·&nbsp; ${esc(fmtDate(acceptance.signed_at || new Date()))}</p>
    </div>`;
}

