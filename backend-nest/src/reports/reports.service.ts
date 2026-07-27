import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Customer } from '../entities/customer.entity';
import { FxService } from '../fx/fx.service';

const VAT_THRESHOLD_AED = 375000; // UAE mandatory VAT registration threshold
const CORP_TAX_THRESHOLD_AED = 375000;
const CORP_TAX_RATE = 0.09;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function sum(arr: any[], key: string) { return arr.reduce((s, x) => s + parseFloat(x[key] || '0'), 0); }

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Recharge) private recharges: Repository<Recharge>,
    @InjectRepository(Expense) private expenses: Repository<Expense>,
    @InjectRepository(TreasuryMovement) private treasury: Repository<TreasuryMovement>,
    @InjectRepository(ComplianceLog) private compliance: Repository<ComplianceLog>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    private fx: FxService,
  ) {}

  async monthlySales(year?: number) {
    const y = year || new Date().getFullYear();
    const rows = await this.recharges
      .createQueryBuilder('r')
      .select("TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM')", 'month')
      .addSelect('SUM(r.amount::numeric)', 'sales')
      .addSelect('COUNT(*)', 'count')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('month')
      .orderBy('month', 'ASC')
      .getRawMany();
    return { year: y, rows };
  }

  async quarterlySales(year?: number) {
    const y = year || new Date().getFullYear();
    const rows = await this.recharges
      .createQueryBuilder('r')
      .select(`'Q' || EXTRACT(QUARTER FROM r.created_at)`, 'quarter')
      .addSelect('SUM(r.amount::numeric)', 'sales')
      .addSelect('COUNT(*)', 'count')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('quarter')
      .orderBy('quarter', 'ASC')
      .getRawMany();
    return { year: y, rows };
  }

  async yearlyPl(year?: number) {
    const y = year || new Date().getFullYear();
    const yStart = new Date(`${y}-01-01T00:00:00Z`);
    const yEnd = new Date(`${y}-12-31T23:59:59Z`);
    const r = await this.recharges.find({ where: { created_at: Between(yStart, yEnd) } });
    const e = await this.expenses.find({ where: { expense_date: Between(yStart, yEnd) } });
    const sales = sum(r, 'amount');
    const exp = e.reduce((s, x) => s + parseFloat(x.aed_value || x.amount || '0'), 0);
    const gross = sales - exp;
    const taxable = Math.max(0, gross - CORP_TAX_THRESHOLD_AED);
    const tax = taxable * CORP_TAX_RATE;
    return { year: y, total_sales: sales, total_expenses: exp, gross_profit: gross, estimated_corp_tax: tax, net_profit: gross - tax };
  }

  async customerRecharge() {
    return this.recharges.createQueryBuilder('r').leftJoinAndSelect('r.customer', 'c').orderBy('r.created_at', 'DESC').getMany();
  }

  /**
   * Aggregated chart data for the Reports dashboard.
   * Returns: kpis + monthly trend + top customers + payment method + gateway breakdown
   */
  async chartsDashboard(year?: number) {
    const y = year || new Date().getFullYear();
    const yStart = new Date(`${y}-01-01T00:00:00Z`);
    const yEnd = new Date(`${y}-12-31T23:59:59Z`);

    // Monthly trend
    const monthly = await this.recharges
      .createQueryBuilder('r')
      .select("TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM')", 'month')
      .addSelect('SUM(r.amount::numeric)', 'sales')
      .addSelect('COUNT(*)', 'count')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('month').orderBy('month', 'ASC').getRawMany();

    // Top 10 customers
    const topCustomers = await this.recharges
      .createQueryBuilder('r')
      .leftJoin('r.customer', 'c')
      .select('COALESCE(c.full_name, r.magnus_username)', 'name')
      .addSelect('c.customer_code', 'code')
      .addSelect('SUM(r.amount::numeric)', 'total')
      .addSelect('COUNT(*)', 'recharges')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('name').addGroupBy('c.customer_code')
      .orderBy('total', 'DESC').limit(10)
      .getRawMany();

    // Coin split (recharges don't carry payment_method — coin is the meaningful axis)
    const methodSplit = await this.recharges
      .createQueryBuilder('r')
      .select('COALESCE(r.crypto_coin, $$Other$$)', 'method')
      .addSelect('SUM(r.amount::numeric)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('method').orderBy('total', 'DESC').getRawMany();

    // Gateway split
    const gatewaySplit = await this.recharges
      .createQueryBuilder('r')
      .select('COALESCE(r.payment_gateway, $$Other$$)', 'gateway')
      .addSelect('SUM(r.amount::numeric)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .groupBy('gateway').orderBy('total', 'DESC').getRawMany();

    // KPIs from yearly P&L
    const pl = await this.yearlyPl(y);
    const vat = await this.vatThreshold();

    return {
      year: y,
      kpis: {
        total_sales: pl.total_sales,
        total_expenses: pl.total_expenses,
        gross_profit: pl.gross_profit,
        net_profit: pl.net_profit,
        estimated_corp_tax: pl.estimated_corp_tax,
        vat_progress_pct: vat.progress_pct,
        vat_remaining_aed: vat.remaining,
      },
      monthly_trend: monthly.map((r) => ({ month: r.month, sales: parseFloat(r.sales || '0'), count: parseInt(r.count || '0', 10) })),
      top_customers: topCustomers.map((r) => ({ name: r.name || '—', code: r.code || '—', total: parseFloat(r.total || '0'), recharges: parseInt(r.recharges || '0', 10) })),
      payment_method_split: methodSplit.map((r) => ({ method: r.method || 'Other', total: parseFloat(r.total || '0'), count: parseInt(r.count || '0', 10) })),
      gateway_split: gatewaySplit.map((r) => ({ gateway: r.gateway || 'Other', total: parseFloat(r.total || '0'), count: parseInt(r.count || '0', 10) })),
    };
  }

  async cryptoToAed() {
    const movements = await this.treasury.find({ where: { converted_to_aed: true }, order: { conversion_date: 'DESC' } });
    const total_usdt = movements.reduce((s, m) => s + parseFloat(m.usdt_converted || '0'), 0);
    const total_aed = movements.reduce((s, m) => s + parseFloat(m.aed_received || '0'), 0);
    return { total_usdt, total_aed, avg_rate: total_usdt > 0 ? (total_aed / total_usdt).toFixed(4) : null, rows: movements };
  }

  async bankReconciliation() {
    const movements = await this.treasury.find({ order: { created_at: 'DESC' } });
    const recharges = await this.recharges.find({ order: { created_at: 'DESC' }, relations: ['customer'] });
    const reconciled = recharges.filter((r) => r.reconciled).length;
    const mismatch = recharges.filter((r) => r.status === 'mismatch').length;
    const pending = recharges.length - reconciled - mismatch;
    return { totals: { reconciled, mismatch, pending, total: recharges.length }, movements, recharges };
  }

  async vatThreshold() {
    const start = new Date(new Date().getFullYear(), 0, 1);
    const r = await this.recharges.find({ where: { created_at: Between(start, new Date()) } });
    const converted = await Promise.all(r.map((row) => this.fx.convertToAed(row.amount, row.currency)));
    const ytdAed = converted.reduce((sum, value) => sum + value, 0);
    return {
      threshold_aed: VAT_THRESHOLD_AED,
      ytd_sales_aed_estimate: ytdAed,
      progress_pct: Math.min(100, (ytdAed / VAT_THRESHOLD_AED) * 100),
      remaining: Math.max(0, VAT_THRESHOLD_AED - ytdAed),
    };
  }

  async corporateTax(year?: number) {
    const pl = await this.yearlyPl(year);
    return {
      year: pl.year,
      gross_profit: pl.gross_profit,
      threshold: CORP_TAX_THRESHOLD_AED,
      rate: CORP_TAX_RATE,
      taxable_amount: Math.max(0, pl.gross_profit - CORP_TAX_THRESHOLD_AED),
      estimated_tax: pl.estimated_corp_tax,
    };
  }

  async expenseReport() {
    const all = await this.expenses.find({ order: { expense_date: 'DESC' } });
    const byCategory: Record<string, number> = {};
    all.forEach((e) => {
      const v = parseFloat(e.aed_value || e.amount || '0');
      byCategory[e.category] = (byCategory[e.category] || 0) + v;
    });
    return { total: all.length, by_category: byCategory, rows: all };
  }

  async suspicious() {
    const high = await this.customers.find({ where: { risk_level: 'High' } });
    const logs = await this.compliance.find({ order: { created_at: 'DESC' }, take: 200 });
    return { high_risk_customers: high, recent_compliance_actions: logs };
  }

  // ================================================================
  //   CA / TAX-FILING FOCUSED REPORTS
  //   Detailed line-item exports designed for Chartered-Accountant
  //   workflow: VAT return prep, corporate tax working paper, expense
  //   ledger with VAT input claim, and full sales journal.
  // ================================================================

  /**
   * Sales Journal — every recharge/invoice for the year with:
   * - date, invoice number, recharge code, customer, magnus username
   * - amount (net), VAT amount (5% UAE standard rate), gross
   * - payment gateway, status
   * This is the primary source document a CA files VAT201 from.
   */
  async salesJournal(year?: number) {
    const y = year || new Date().getFullYear();
    const rows = await this.recharges
      .createQueryBuilder('r')
      .leftJoin('customers', 'c', 'c.id = r.customer_id')
      .select([
        "TO_CHAR(r.created_at, 'YYYY-MM-DD') AS date",
        'r.recharge_code AS recharge_code',
        'r.invoice_id AS invoice_id',
        'c.full_name AS customer_name',
        'c.customer_code AS customer_code',
        'r.magnus_username AS magnus_username',
        'r.amount AS amount',
        'r.currency AS currency',
        'r.payment_gateway AS payment_gateway',
        'r.status AS status',
      ])
      .where('EXTRACT(YEAR FROM r.created_at) = :y', { y })
      .orderBy('r.created_at', 'ASC')
      .getRawMany();
    const VAT_RATE = 0.05;
    const enriched = rows.map((r) => {
      const gross = parseFloat(r.amount || '0');
      // For UAE, VAT is included in the invoice amount → net = gross / 1.05
      const net = +(gross / (1 + VAT_RATE)).toFixed(2);
      const vat = +(gross - net).toFixed(2);
      return { ...r, net_amount: net, vat_amount: vat, gross_amount: gross };
    });
    return {
      year: y,
      vat_rate_pct: VAT_RATE * 100,
      total_gross: +enriched.reduce((s, r) => s + r.gross_amount, 0).toFixed(2),
      total_net: +enriched.reduce((s, r) => s + r.net_amount, 0).toFixed(2),
      total_vat: +enriched.reduce((s, r) => s + r.vat_amount, 0).toFixed(2),
      count: enriched.length,
      rows: enriched,
    };
  }

  /**
   * VAT Return — UAE VAT201-style summary for the given quarter or year.
   * Splits standard-rated sales (5%), zero-rated, and computes net VAT
   * payable/refundable. Input VAT recovered from expenses with tax_amount.
   */
  async vatReturn(year?: number, quarter?: number) {
    const y = year || new Date().getFullYear();
    const q = quarter ? parseInt(String(quarter), 10) : null;
    const startMonth = q ? (q - 1) * 3 + 1 : 1;
    const endMonth = q ? q * 3 : 12;
    const start = new Date(Date.UTC(y, startMonth - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(y, endMonth, 0, 23, 59, 59));
    const VAT_RATE = 0.05;

    // Output VAT (from sales / recharges — VAT-inclusive)
    const sales = await this.recharges
      .createQueryBuilder('r')
      .where('r.created_at BETWEEN :s AND :e', { s: start, e: end })
      .getMany();
    const salesGross = sales.reduce((s, r) => s + parseFloat(r.amount || '0'), 0);
    const salesNet = salesGross / (1 + VAT_RATE);
    const outputVat = salesGross - salesNet;

    // Input VAT (from expenses — using tax_amount if present, else 0)
    const exps = await this.expenses
      .createQueryBuilder('e')
      .where('e.expense_date BETWEEN :s AND :e', { s: start, e: end })
      .getMany();
    let inputVat = 0;
    let inputNet = 0;
    exps.forEach((e: any) => {
      const gross = parseFloat(e.aed_value || e.amount || '0');
      const tax = parseFloat(e.tax_amount || '0');
      if (tax > 0) {
        inputVat += tax;
        inputNet += (gross - tax);
      } else {
        // Not VAT-registered vendor → no input claim
        inputNet += gross;
      }
    });

    const netVatPayable = outputVat - inputVat;
    return {
      year: y,
      quarter: q,
      period: {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      },
      vat_rate_pct: VAT_RATE * 100,
      output_vat: {
        sales_count: sales.length,
        sales_gross_aed: +salesGross.toFixed(2),
        sales_net_aed: +salesNet.toFixed(2),
        output_vat_aed: +outputVat.toFixed(2),
      },
      input_vat: {
        expenses_count: exps.length,
        expenses_net_aed: +inputNet.toFixed(2),
        input_vat_aed: +inputVat.toFixed(2),
      },
      net_vat_payable_aed: +netVatPayable.toFixed(2),
      status: netVatPayable > 0 ? 'PAYABLE' : 'REFUNDABLE',
    };
  }

  /**
   * Expense Ledger — full line-item view of every expense for a year,
   * grouped by category with VAT breakdown. This is the CA's primary
   * source for input-VAT recovery + corporate-tax deduction working.
   */
  async expenseLedger(year?: number) {
    const y = year || new Date().getFullYear();
    const all = await this.expenses
      .createQueryBuilder('e')
      .where('EXTRACT(YEAR FROM e.expense_date) = :y', { y })
      .orderBy('e.expense_date', 'DESC')
      .getMany();
    const rows = all.map((e: any) => {
      const gross = parseFloat(e.aed_value || e.amount || '0');
      const tax = parseFloat(e.tax_amount || '0');
      return {
        date: e.expense_date ? new Date(e.expense_date).toISOString().slice(0, 10) : null,
        category: e.category || 'Other',
        vendor: e.vendor_name || e.description || '',
        description: e.description || '',
        gross_aed: +gross.toFixed(2),
        input_vat_aed: +tax.toFixed(2),
        net_aed: +(gross - tax).toFixed(2),
        payment_method: e.payment_method || '',
        currency: e.currency || 'AED',
        reference: e.reference || '',
      };
    });
    const byCategory: Record<string, { gross: number; net: number; vat: number; count: number }> = {};
    rows.forEach((r) => {
      const b = (byCategory[r.category] = byCategory[r.category] || { gross: 0, net: 0, vat: 0, count: 0 });
      b.gross += r.gross_aed;
      b.net += r.net_aed;
      b.vat += r.input_vat_aed;
      b.count += 1;
    });
    Object.keys(byCategory).forEach((k) => {
      byCategory[k].gross = +byCategory[k].gross.toFixed(2);
      byCategory[k].net = +byCategory[k].net.toFixed(2);
      byCategory[k].vat = +byCategory[k].vat.toFixed(2);
    });
    return {
      year: y,
      total_count: rows.length,
      total_gross: +rows.reduce((s, r) => s + r.gross_aed, 0).toFixed(2),
      total_input_vat: +rows.reduce((s, r) => s + r.input_vat_aed, 0).toFixed(2),
      total_net: +rows.reduce((s, r) => s + r.net_aed, 0).toFixed(2),
      by_category: byCategory,
      rows,
    };
  }

  /**
   * Corporate Tax Working Paper — detailed calculation with base P&L,
   * non-deductible expenses (none currently flagged), free-zone
   * relief indicator, taxable income and 9% tax on excess above 375K.
   */
  async corporateTaxWorking(year?: number) {
    const y = year || new Date().getFullYear();
    const pl = await this.yearlyPl(y);
    const grossProfit = pl.gross_profit;
    const threshold = CORP_TAX_THRESHOLD_AED;
    const taxable = Math.max(0, grossProfit - threshold);
    return {
      year: y,
      period: `01 Jan ${y} — 31 Dec ${y}`,
      revenue_aed: pl.total_sales,
      total_expenses_aed: pl.total_expenses,
      gross_profit_aed: grossProfit,
      non_deductible_addbacks: 0,
      free_zone_relief: 0,
      taxable_income_aed: grossProfit,
      first_bracket_threshold_aed: threshold,
      first_bracket_taxable_aed: Math.min(grossProfit, threshold),
      first_bracket_rate_pct: 0,
      first_bracket_tax_aed: 0,
      second_bracket_taxable_aed: taxable,
      second_bracket_rate_pct: CORP_TAX_RATE * 100,
      second_bracket_tax_aed: +(taxable * CORP_TAX_RATE).toFixed(2),
      total_estimated_tax_aed: +(taxable * CORP_TAX_RATE).toFixed(2),
      status: grossProfit <= threshold
        ? 'Below AED 375K threshold — 0% CT'
        : `9% payable on AED ${(taxable).toLocaleString('en-AE')} above threshold`,
    };
  }
}
