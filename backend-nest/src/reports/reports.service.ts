import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Customer } from '../entities/customer.entity';

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
    // Year-to-date sales — convert to AED where currency != AED using treasury aed_value if available
    const start = new Date(new Date().getFullYear(), 0, 1);
    const r = await this.recharges.find({ where: { created_at: Between(start, new Date()) } });
    const ytdAed = r.reduce((s, x) => {
      if (x.currency === 'AED') return s + parseFloat(x.amount || '0');
      // assume 3.67 default if not AED — purely for tracker estimate
      return s + parseFloat(x.amount || '0') * 3.67;
    }, 0);
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
}
