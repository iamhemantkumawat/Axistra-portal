import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { Customer } from '../entities/customer.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { FxService } from '../fx/fx.service';

const VAT_THRESHOLD_AED = 375000;

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfMonth() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
function startOfYear() { return new Date(new Date().getFullYear(), 0, 1); }
function sum(arr: any[], key: string) { return arr.reduce((s, x) => s + parseFloat(x[key] || '0'), 0); }

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(Expense) private expenseRepo: Repository<Expense>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(TreasuryMovement) private treasuryRepo: Repository<TreasuryMovement>,
    @InjectRepository(ComplianceLog) private complianceRepo: Repository<ComplianceLog>,
    private fx: FxService,
  ) {}

  async kpis() {
    const today = startOfToday();
    const monthStart = startOfMonth();
    const yearStart = startOfYear();
    const now = new Date();

    const [dailyR, monthlyR, yearlyR, allR] = await Promise.all([
      this.rechargeRepo.find({ where: { created_at: Between(today, now) } }),
      this.rechargeRepo.find({ where: { created_at: Between(monthStart, now) } }),
      this.rechargeRepo.find({ where: { created_at: Between(yearStart, now) } }),
      this.rechargeRepo.find(),
    ]);

    const [monthlyE, yearlyE] = await Promise.all([
      this.expenseRepo.find({ where: { expense_date: Between(monthStart, now) } }),
      this.expenseRepo.find({ where: { expense_date: Between(yearStart, now) } }),
    ]);

    const treasury = await this.treasuryRepo.find();
    const total_crypto_received = treasury.reduce((s, t) => s + parseFloat(t.total_usdt_received || '0'), 0);
    const total_aed_converted = treasury.reduce((s, t) => s + parseFloat(t.aed_received || '0'), 0);
    const total_wio_deposits = treasury.filter((t) => t.transferred_to_wio).reduce((s, t) => s + parseFloat(t.wio_aed_amount || t.aed_received || '0'), 0);

    const customers_count = await this.customerRepo.count();
    const high_risk = await this.customerRepo.count({ where: { risk_level: 'High' } });

    const pending_reconciliation = allR.filter((r) => !r.reconciled && r.status !== 'refunded').length;
    const mismatch_count = allR.filter((r) => r.status === 'mismatch').length;

    const ytdAedParts = await Promise.all(
      yearlyR.map((recharge) => this.fx.convertToAed(recharge.amount, recharge.currency)),
    );
    const ytdAedEstimate = ytdAedParts.reduce((sum, value) => sum + value, 0);

    const monthlySales = sum(monthlyR, 'amount');
    const monthlyExp = monthlyE.reduce((s, e) => s + parseFloat(e.aed_value || e.amount || '0'), 0);
    const yearlySales = sum(yearlyR, 'amount');
    const yearlyExp = yearlyE.reduce((s, e) => s + parseFloat(e.aed_value || e.amount || '0'), 0);

    return {
      daily: { sales: sum(dailyR, 'amount'), count: dailyR.length },
      monthly: { sales: monthlySales, expenses: monthlyExp, profit: monthlySales - monthlyExp, count: monthlyR.length },
      yearly: { sales: yearlySales, expenses: yearlyExp, gross_profit: yearlySales - yearlyExp, count: yearlyR.length },
      treasury: { total_crypto_received, total_aed_converted, total_wio_deposits },
      customers: { total: customers_count, high_risk },
      reconciliation: { pending: pending_reconciliation, mismatch: mismatch_count },
      vat: {
        threshold_aed: VAT_THRESHOLD_AED,
        ytd_aed: ytdAedEstimate,
        pct: Math.min(100, (ytdAedEstimate / VAT_THRESHOLD_AED) * 100),
      },
    };
  }

  async chart() {
    // Last 12 months sales
    const rows = await this.rechargeRepo
      .createQueryBuilder('r')
      .select("TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM')", 'month')
      .addSelect('SUM(r.amount::numeric)', 'sales')
      .addSelect('COUNT(*)', 'count')
      .where("r.created_at >= NOW() - INTERVAL '12 months'")
      .groupBy('month')
      .orderBy('month', 'ASC')
      .getRawMany();
    return rows;
  }

  async recent() {
    const recharges = await this.rechargeRepo.find({ order: { created_at: 'DESC' }, take: 10, relations: ['customer'] });
    const compliance = await this.complianceRepo.find({ order: { created_at: 'DESC' }, take: 10 });
    return { recharges, compliance };
  }
}
