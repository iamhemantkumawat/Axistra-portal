import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ReportsService } from './reports.service';

@UseGuards(AuthGuard('jwt'))
@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}

  @Get('monthly-sales')
  monthly(@Query('year') year?: string) { return this.svc.monthlySales(year ? parseInt(year, 10) : undefined); }

  @Get('quarterly-sales')
  quarterly(@Query('year') year?: string) { return this.svc.quarterlySales(year ? parseInt(year, 10) : undefined); }

  @Get('yearly-pl')
  yearly(@Query('year') year?: string) { return this.svc.yearlyPl(year ? parseInt(year, 10) : undefined); }

  @Get('customer-recharge')
  custRecharge() { return this.svc.customerRecharge(); }

  @Get('crypto-to-aed')
  cryptoAed() { return this.svc.cryptoToAed(); }

  @Get('bank-reconciliation')
  bank() { return this.svc.bankReconciliation(); }

  @Get('vat-threshold')
  vat() { return this.svc.vatThreshold(); }

  @Get('corporate-tax')
  corp(@Query('year') year?: string) { return this.svc.corporateTax(year ? parseInt(year, 10) : undefined); }

  @Get('expenses')
  exp() { return this.svc.expenseReport(); }

  @Get('suspicious')
  sus() { return this.svc.suspicious(); }

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
    const ExcelJS = require('exceljs');
    const data = await this.fetchByName(report, year);
    const rows = this.flatten(data);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report || 'report');
    if (rows.length) {
      ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: 22 }));
      rows.forEach((r) => ws.addRow(r));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A5C3E' } };
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report}-${year || 'current'}.xlsx"`);
    res.send(Buffer.from(buf));
  }

  private async fetchByName(report: string, year?: string) {
    const y = year ? parseInt(year, 10) : undefined;
    switch (report) {
      case 'monthly-sales': return (await this.svc.monthlySales(y)).rows;
      case 'quarterly-sales': return (await this.svc.quarterlySales(y)).rows;
      case 'yearly-pl': return [await this.svc.yearlyPl(y)];
      case 'customer-recharge': return await this.svc.customerRecharge();
      case 'crypto-to-aed': return (await this.svc.cryptoToAed()).rows;
      case 'bank-reconciliation': return (await this.svc.bankReconciliation()).recharges;
      case 'vat-threshold': return [await this.svc.vatThreshold()];
      case 'corporate-tax': return [await this.svc.corporateTax(y)];
      case 'expenses': return (await this.svc.expenseReport()).rows;
      case 'suspicious': return (await this.svc.suspicious()).recent_compliance_actions;
      default: return [];
    }
  }

  private flatten(data: any): any[] {
    if (!Array.isArray(data)) return [data];
    return data.map((row) => {
      const flat: any = {};
      for (const k of Object.keys(row || {})) {
        const v = row[k];
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          flat[k] = JSON.stringify(v).slice(0, 120);
        } else {
          flat[k] = v;
        }
      }
      return flat;
    });
  }

  private toCsv(rows: any[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  }
}
