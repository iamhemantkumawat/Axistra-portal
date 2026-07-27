import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { renderReportPdf, renderCoverPdf, ReportPdfInput } from './report-template';

const REPORT_META: Record<string, { title: string; subtitle?: string; columns?: string[]; footer?: string }> = {
  'monthly-sales':        { title: 'Monthly Sales',         subtitle: 'Revenue grouped by calendar month for the selected year.' },
  'quarterly-sales':      { title: 'Quarterly Sales',       subtitle: 'Revenue grouped by fiscal quarter.' },
  'yearly-pl':            { title: 'Yearly Profit & Loss',  subtitle: 'Aggregate sales, expenses, profit and estimated corporate tax for the year.' },
  'customer-recharge':    { title: 'Customer Recharge Ledger', subtitle: 'Every recharge with the associated customer, gateway and status.' },
  'crypto-to-aed':        { title: 'Crypto → AED Conversion', subtitle: 'USDT converted to AED via OKX/Binance with average rate.' },
  'bank-reconciliation':  { title: 'Bank Reconciliation',   subtitle: 'Match between Magnus credit, treasury movements and Wio bank deposits.' },
  'vat-threshold':        { title: 'VAT Threshold Tracker', subtitle: 'Year-to-date taxable sales against the AED 375,000 UAE VAT registration threshold.' },
  'corporate-tax':        { title: 'Corporate Tax Estimate', subtitle: 'Estimated UAE corporate tax (9% above AED 375,000 of taxable profit).' },
  'expenses':             { title: 'Expense Report',         subtitle: 'All operating expenses with category and payment method.' },
  'suspicious':           { title: 'Suspicious Activity / Compliance', subtitle: 'High-risk customers and recent compliance actions.' },
  'sales-journal':        { title: 'Sales Journal (VAT-ready)',   subtitle: 'Every invoice with net/VAT/gross split — primary source for VAT201 filing.' },
  'vat-return':           { title: 'VAT Return (VAT201-style)',   subtitle: 'Output VAT (sales) minus Input VAT (expenses) → net payable/refundable.' },
  'expense-ledger':       { title: 'Expense Ledger',              subtitle: 'Detailed expense list with vendor, category, VAT input, and net.' },
  'corporate-tax-working': { title: 'Corporate Tax Working Paper', subtitle: 'Full 9% UAE CT computation with bracket breakdown.' },
};

@UseGuards(AuthGuard('jwt'))
@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}

  @Get('monthly-sales')     monthly(@Query('year') year?: string) { return this.svc.monthlySales(year ? parseInt(year, 10) : undefined); }
  @Get('quarterly-sales')   quarterly(@Query('year') year?: string) { return this.svc.quarterlySales(year ? parseInt(year, 10) : undefined); }
  @Get('yearly-pl')         yearly(@Query('year') year?: string) { return this.svc.yearlyPl(year ? parseInt(year, 10) : undefined); }
  @Get('customer-recharge') custRecharge() { return this.svc.customerRecharge(); }
  @Get('crypto-to-aed')     cryptoAed() { return this.svc.cryptoToAed(); }
  @Get('bank-reconciliation') bank() { return this.svc.bankReconciliation(); }
  @Get('vat-threshold')     vat() { return this.svc.vatThreshold(); }
  @Get('corporate-tax')     corp(@Query('year') year?: string) { return this.svc.corporateTax(year ? parseInt(year, 10) : undefined); }
  @Get('expenses')          exp() { return this.svc.expenseReport(); }
  @Get('suspicious')        sus() { return this.svc.suspicious(); }
  @Get('sales-journal')     salesJ(@Query('year') year?: string) { return this.svc.salesJournal(year ? parseInt(year, 10) : undefined); }
  @Get('vat-return')        vatRet(@Query('year') year?: string, @Query('quarter') q?: string) { return this.svc.vatReturn(year ? parseInt(year, 10) : undefined, q ? parseInt(q, 10) : undefined); }
  @Get('expense-ledger')    expL(@Query('year') year?: string) { return this.svc.expenseLedger(year ? parseInt(year, 10) : undefined); }
  @Get('corporate-tax-working') ctW(@Query('year') year?: string) { return this.svc.corporateTaxWorking(year ? parseInt(year, 10) : undefined); }

  @Get('dashboard/charts')
  charts(@Query('year') year?: string) { return this.svc.chartsDashboard(year ? parseInt(year, 10) : undefined); }

  // Generic CSV/Excel export
  @Get('export/csv')
  async csv(@Query('report') report: string, @Query('year') year: string, @Res() res: Response) {
    const data = await this.fetchByName(report, year);
    const rows = this.flatten(data);
    const csv = this.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${report}-${year || 'current'}.csv"`);
    res.send(csv);
  }

  @Get('export/excel')
  async excel(@Query('report') report: string, @Query('year') year: string, @Res() res: Response) {
    const buf = await this.buildExcel(report, year);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report}-${year || 'current'}.xlsx"`);
    res.send(buf);
  }

  @Get('export/pdf')
  async pdf(@Query('report') report: string, @Query('year') year: string, @Res() res: Response) {
    const buf = await this.buildPdf(report, year);
    const isPdf = buf.slice(0, 4).toString() === '%PDF';
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html');
    if (isPdf) res.setHeader('Content-Disposition', `attachment; filename="${report}-${year || 'current'}.pdf"`);
    res.send(buf);
  }

  @Get('bundle/month-end')
  async bundle(@Query('year') year: string, @Query('month') month: string, @Res() res: Response) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const archiver = require('archiver');
    const y = year || String(new Date().getFullYear());
    const m = month || String(new Date().getMonth() + 1).padStart(2, '0');
    const label = `${y}-${m}`;

    const include = ['yearly-pl', 'vat-threshold', 'corporate-tax', 'bank-reconciliation'];

    const coverPdf = await renderCoverPdf({
      title: `Month-End Bundle ${label}`,
      subtitle: `Accountant-ready package for ${label}: VAT threshold, P&L, Corporate Tax estimate and Bank Reconciliation. All amounts are computed live from the Axistra Compliance + Accounting Portal at generation time.`,
      items: include.map((k) => ({ name: REPORT_META[k]?.title || k, desc: REPORT_META[k]?.subtitle })),
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="axistra-month-end-${label}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => res.status(500).send(String(err)));
    archive.pipe(res);

    archive.append(coverPdf, { name: `00-Cover-${label}.pdf` });

    let idx = 1;
    for (const key of include) {
      const pdfBuf = await this.buildPdf(key, y);
      const xlsxBuf = await this.buildExcel(key, y);
      const num = String(idx).padStart(2, '0');
      archive.append(pdfBuf, { name: `${num}-${key}-${label}.pdf` });
      archive.append(xlsxBuf, { name: `${num}-${key}-${label}.xlsx` });
      idx += 1;
    }
    await archive.finalize();
  }

  /**
   * Accountant-ready annual export — bundles EVERY report for the year as PDF + Excel
   * plus a CSV manifest. Designed to be handed straight to an external accountant
   * for filing/audit.
   */
  @Get('bundle/accountant-pack')
  async accountantPack(@Query('year') year: string, @Res() res: Response) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const archiver = require('archiver');
    const y = year || String(new Date().getFullYear());
    const label = `${y}`;

    const include = [
      'yearly-pl',
      'monthly-sales',
      'quarterly-sales',
      'vat-threshold',
      'corporate-tax',
      'sales-journal',
      'vat-return',
      'expense-ledger',
      'corporate-tax-working',
      'customer-recharge',
      'crypto-to-aed',
      'bank-reconciliation',
      'expenses',
      'suspicious',
    ];

    const coverPdf = await renderCoverPdf({
      title: `Accountant Annual Pack ${label}`,
      subtitle: `Comprehensive Axistra Technologies FZCO export for FY ${label}. Includes P&L, VAT threshold tracker, Corporate Tax estimate, full customer recharge ledger, crypto → AED conversion log, bank reconciliation, expenses and any flagged suspicious activity. All amounts computed live at generation time — TRN 105415374500001.`,
      items: include.map((k) => ({ name: REPORT_META[k]?.title || k, desc: REPORT_META[k]?.subtitle })),
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="axistra-accountant-pack-${label}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => res.status(500).send(String(err)));
    archive.pipe(res);

    archive.append(coverPdf, { name: `00-Cover-${label}.pdf` });

    // Per-report PDFs + Excel exports
    const manifestRows: Array<{ file: string; report: string; rows: number; bytes: number }> = [];
    let idx = 1;
    for (const key of include) {
      const pdfBuf = await this.buildPdf(key, y);
      const xlsxBuf = await this.buildExcel(key, y);
      const num = String(idx).padStart(2, '0');
      const pdfName = `${num}-${key}-${label}.pdf`;
      const xlsxName = `${num}-${key}-${label}.xlsx`;
      archive.append(pdfBuf, { name: pdfName });
      archive.append(xlsxBuf, { name: xlsxName });
      const raw = await this.fetchByName(key, y);
      const rowCount = Array.isArray(raw) ? raw.length : raw ? 1 : 0;
      manifestRows.push({ file: pdfName, report: REPORT_META[key]?.title || key, rows: rowCount, bytes: pdfBuf.length });
      manifestRows.push({ file: xlsxName, report: REPORT_META[key]?.title || key, rows: rowCount, bytes: xlsxBuf.length });
      idx += 1;
    }

    // CSV manifest so the accountant has a single index of every file in the pack.
    const manifestCsv = [
      'file,report,rows,bytes',
      ...manifestRows.map((r) => `${r.file},"${r.report.replace(/"/g, '""')}",${r.rows},${r.bytes}`),
    ].join('\n');
    archive.append(manifestCsv, { name: `MANIFEST-${label}.csv` });

    // Plain-text README explaining the audit chain and contents.
    const readme = [
      `Axistra Technologies — FZCO`,
      `Accountant Annual Pack — FY ${label}`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `Audit Chain (immutable):`,
      `  Customer → Invoice → Crypto TX Hash → Magnus Credit → OKX Conversion → Wio Bank Deposit`,
      ``,
      `Files in this pack:`,
      ...include.map((k, i) => `  ${String(i + 1).padStart(2, '0')}. ${REPORT_META[k]?.title || k} — ${REPORT_META[k]?.subtitle || ''}`),
      ``,
      `Each report is provided as PDF (printable) and XLSX (machine-readable).`,
      `MANIFEST-${label}.csv lists every file with row counts and byte sizes.`,
      ``,
      `Corporate TRN: 105415374500001 · Trade License: 86256 · Authority: IFZA / Dubai Silicon Oasis`,
    ].join('\n');
    archive.append(readme, { name: `README-${label}.txt` });

    await archive.finalize();
  }

  // ---------- helpers ----------

  private async fetchByName(report: string, year?: string) {
    const y = year ? parseInt(year, 10) : undefined;
    switch (report) {
      case 'monthly-sales':      return (await this.svc.monthlySales(y)).rows;
      case 'quarterly-sales':    return (await this.svc.quarterlySales(y)).rows;
      case 'yearly-pl':          return [await this.svc.yearlyPl(y)];
      case 'customer-recharge':  return await this.svc.customerRecharge();
      case 'crypto-to-aed':      return (await this.svc.cryptoToAed()).rows;
      case 'bank-reconciliation': return (await this.svc.bankReconciliation()).recharges;
      case 'vat-threshold':      return [await this.svc.vatThreshold()];
      case 'corporate-tax':      return [await this.svc.corporateTax(y)];
      case 'expenses':           return (await this.svc.expenseReport()).rows;
      case 'suspicious':         return (await this.svc.suspicious()).recent_compliance_actions;
      case 'sales-journal':      return (await this.svc.salesJournal(y)).rows;
      case 'vat-return':         return [await this.svc.vatReturn(y)];
      case 'expense-ledger':     return (await this.svc.expenseLedger(y)).rows;
      case 'corporate-tax-working': return [await this.svc.corporateTaxWorking(y)];
      default: return [];
    }
  }

  private async buildPdf(report: string, year?: string): Promise<Buffer> {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const meta = REPORT_META[report] || { title: report };
    const raw = await this.fetchByName(report, year);
    const rows = this.flatten(raw);

    // KPI strip for select reports
    const kpis: Array<{ label: string; value: string }> = [];
    if (report === 'yearly-pl') {
      const pl: any = (raw && raw[0]) || {};
      kpis.push({ label: 'Sales', value: this.aed(pl.total_sales) });
      kpis.push({ label: 'Expenses', value: this.aed(pl.total_expenses) });
      kpis.push({ label: 'Gross Profit', value: this.aed(pl.gross_profit) });
      kpis.push({ label: 'Net Profit', value: this.aed(pl.net_profit) });
      kpis.push({ label: 'Est. Corp Tax', value: this.aed(pl.estimated_corp_tax) });
    } else if (report === 'vat-threshold') {
      const v: any = (raw && raw[0]) || {};
      kpis.push({ label: 'YTD Sales (AED)', value: this.aed(v.ytd_sales_aed_estimate) });
      kpis.push({ label: 'Threshold', value: 'AED 375,000' });
      kpis.push({ label: 'Progress', value: `${parseFloat(v.progress_pct || 0).toFixed(1)}%` });
      kpis.push({ label: 'Remaining', value: this.aed(v.remaining) });
    } else if (report === 'corporate-tax') {
      const c: any = (raw && raw[0]) || {};
      kpis.push({ label: 'Gross Profit', value: this.aed(c.gross_profit) });
      kpis.push({ label: 'Threshold', value: this.aed(c.threshold) });
      kpis.push({ label: 'Taxable', value: this.aed(c.taxable_amount) });
      kpis.push({ label: 'Est. Tax (9%)', value: this.aed(c.estimated_tax) });
    } else if (report === 'bank-reconciliation') {
      const b = await this.svc.bankReconciliation();
      kpis.push({ label: 'Reconciled', value: String(b.totals.reconciled) });
      kpis.push({ label: 'Mismatch', value: String(b.totals.mismatch) });
      kpis.push({ label: 'Pending', value: String(b.totals.pending) });
      kpis.push({ label: 'Total', value: String(b.totals.total) });
    }

    // Cap rows to keep PDF manageable
    const limited = rows.slice(0, 200);

    const input: ReportPdfInput = {
      title: meta.title,
      subtitle: meta.subtitle,
      period: `Year ${y}`,
      kpis,
      columns: limited[0] ? Object.keys(limited[0]) : [],
      rows: limited,
      footer: `Axistra Technologies — FZCO · TRN 105415374500001 · License 86256 · ${meta.title} · ${y}. Rows shown: ${limited.length}${rows.length > limited.length ? ` of ${rows.length} (use Excel export for full set)` : ''}.`,
    };
    return renderReportPdf(input);
  }

  private async buildExcel(report: string, year?: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const meta = REPORT_META[report] || { title: report };
    const raw = await this.fetchByName(report, year);
    const rows = this.flatten(raw);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Axistra Compliance + Accounting Portal';
    wb.created = new Date();
    const ws = wb.addWorksheet(report || 'report', { properties: { tabColor: { argb: 'FF0A5C3E' } } });

    // Banner row
    ws.mergeCells('A1:F1');
    const banner = ws.getCell('A1');
    banner.value = `${meta.title} · Year ${year || new Date().getFullYear()}`;
    banner.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A5C3E' } };
    banner.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 22;

    ws.mergeCells('A2:F2');
    const sub = ws.getCell('A2');
    sub.value = meta.subtitle || '';
    sub.font = { italic: true, color: { argb: 'FF36534A' } };

    ws.addRow([]);

    if (rows.length) {
      const headerRow = ws.addRow(Object.keys(rows[0]));
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A5C3E' } };
      headerRow.alignment = { horizontal: 'left' };
      ws.columns = Object.keys(rows[0]).map((k) => ({ key: k, width: Math.min(36, Math.max(14, k.length + 4)) }));
      rows.forEach((r) => ws.addRow(r));
      // Add filter
      const lastCol = String.fromCharCode(64 + Object.keys(rows[0]).length);
      ws.autoFilter = { from: `A4`, to: `${lastCol}${rows.length + 4}` };
    } else {
      ws.addRow(['No data for this period']);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private aed(v: any): string {
    const n = parseFloat(v || 0);
    return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private flatten(data: any): any[] {
    if (!Array.isArray(data)) return [data];
    return data.map((row) => {
      const flat: any = {};
      for (const k of Object.keys(row || {})) {
        const v = row[k];
        if (v && typeof v === 'object' && !(v instanceof Date)) flat[k] = JSON.stringify(v).slice(0, 120);
        else flat[k] = v;
      }
      return flat;
    });
  }

  private toCsv(rows: any[]): string {
    if (!rows || !rows.length) return 'notice\nNo data for the selected period.\n';
    const headers = Object.keys(rows[0]);
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  }
}
