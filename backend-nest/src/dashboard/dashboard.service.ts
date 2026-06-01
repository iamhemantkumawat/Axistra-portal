import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { Recharge } from '../entities/recharge.entity';
import { Expense } from '../entities/expense.entity';
import { Customer } from '../entities/customer.entity';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { ComplianceLog } from '../entities/compliance-log.entity';
import { Invoice } from '../entities/invoice.entity';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollItem } from '../entities/payroll-item.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { TaxFiling } from '../entities/tax-filing.entity';
import { AppSetting } from '../entities/app-setting.entity';
import { FxService } from '../fx/fx.service';
import { renderNetWorthPdf, NetWorthInput, NetWorthLineItem } from './net-worth-template';

const VAT_THRESHOLD_AED = 375000;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfToday() { return startOfDay(new Date()); }
function startOfMonth() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
function startOfYear() { return new Date(new Date().getFullYear(), 0, 1); }
function startOfPrevMonth() { const d = startOfMonth(); d.setMonth(d.getMonth() - 1); return d; }
function endOfPrevMonth() { const d = startOfMonth(); d.setMilliseconds(-1); return d; }

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    @InjectRepository(Expense) private expenseRepo: Repository<Expense>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(TreasuryMovement) private treasuryRepo: Repository<TreasuryMovement>,
    @InjectRepository(ComplianceLog) private complianceRepo: Repository<ComplianceLog>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(PayrollRun) private payrollRunRepo: Repository<PayrollRun>,
    @InjectRepository(PayrollItem) private payrollItemRepo: Repository<PayrollItem>,
    @InjectRepository(BankAccount) private bankRepo: Repository<BankAccount>,
    @InjectRepository(WalletLedger) private ledgerRepo: Repository<WalletLedger>,
    @InjectRepository(TaxFiling) private taxRepo: Repository<TaxFiling>,
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
    private fx: FxService,
  ) {}

  /**
   * Sum the AED equivalent of an array of recharges using the live FX feed.
   * Mixed-currency recharges (EUR/USD/INR/USDT) are converted to AED before
   * summing — that's the canonical value the dashboard displays.
   */
  private async sumRechargesAed(rs: Recharge[]): Promise<number> {
    if (!rs.length) return 0;
    const parts = await Promise.all(rs.map((r) => this.fx.convertToAed(r.amount, r.currency)));
    return parts.reduce((a, b) => a + b, 0);
  }

  private sumExpensesAed(es: Expense[]): number {
    // Expenses already have aed_value when entered via crypto/multi-currency.
    // Fallback to `amount` when currency is AED (the common case).
    return es.reduce((s, e) => {
      const aed = parseFloat(e.aed_value || '');
      if (Number.isFinite(aed) && aed > 0) return s + aed;
      // amount is AED if currency=AED, else best-effort raw (won't be reached often)
      return s + parseFloat(e.amount || '0');
    }, 0);
  }

  /**
   * Group an array of records by their currency, returning original-currency
   * subtotals so the UI can show "466 EUR + 100 USD + …" alongside the
   * AED-converted master figure.
   */
  private breakdownByCurrency(rs: Array<{ amount: any; currency?: string | null }>) {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of rs) {
      const cur = String(r.currency || 'AED').toUpperCase();
      const slot = map.get(cur) || { amount: 0, count: 0 };
      slot.amount += parseFloat(String(r.amount || 0)) || 0;
      slot.count += 1;
      map.set(cur, slot);
    }
    return Array.from(map.entries()).map(([currency, v]) => ({ currency, ...v }));
  }

  async kpis() {
    const today = startOfToday();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const monthStart = startOfMonth();
    const prevMonthStart = startOfPrevMonth();
    const prevMonthEnd = endOfPrevMonth();
    const yearStart = startOfYear();
    const now = new Date();
    const thirty = new Date(now); thirty.setDate(thirty.getDate() - 30);

    const [dailyR, yesterdayR, monthlyR, prevMonthlyR, yearlyR, allR, thirtyR] = await Promise.all([
      this.rechargeRepo.find({ where: { created_at: Between(today, now) } }),
      this.rechargeRepo.find({ where: { created_at: Between(yesterday, today) } }),
      this.rechargeRepo.find({ where: { created_at: Between(monthStart, now) } }),
      this.rechargeRepo.find({ where: { created_at: Between(prevMonthStart, prevMonthEnd) } }),
      this.rechargeRepo.find({ where: { created_at: Between(yearStart, now) } }),
      this.rechargeRepo.find(),
      this.rechargeRepo.find({ where: { created_at: MoreThanOrEqual(thirty) } }),
    ]);
    const [monthlyE, prevMonthlyE, yearlyE] = await Promise.all([
      this.expenseRepo.find({ where: { expense_date: Between(monthStart, now) } }),
      this.expenseRepo.find({ where: { expense_date: Between(prevMonthStart, prevMonthEnd) } }),
      this.expenseRepo.find({ where: { expense_date: Between(yearStart, now) } }),
    ]);

    // AED-converted totals
    const [
      dailySalesAed, yesterdaySalesAed, monthlySalesAed,
      prevMonthSalesAed, yearlySalesAed, thirtyDaySalesAed,
    ] = await Promise.all([
      this.sumRechargesAed(dailyR),
      this.sumRechargesAed(yesterdayR),
      this.sumRechargesAed(monthlyR),
      this.sumRechargesAed(prevMonthlyR),
      this.sumRechargesAed(yearlyR),
      this.sumRechargesAed(thirtyR),
    ]);
    const monthlyExpAed = this.sumExpensesAed(monthlyE);
    const prevMonthlyExpAed = this.sumExpensesAed(prevMonthlyE);
    const yearlyExpAed = this.sumExpensesAed(yearlyE);

    // Treasury — already in AED
    const treasury = await this.treasuryRepo.find();
    const total_crypto_received = treasury.reduce((s, t) => s + parseFloat(t.total_usdt_received || '0'), 0);
    const total_aed_converted = treasury.reduce((s, t) => s + parseFloat(t.aed_received || '0'), 0);
    const total_wio_deposits = treasury.filter((t) => t.transferred_to_wio).reduce((s, t) => s + parseFloat(t.wio_aed_amount || t.aed_received || '0'), 0);
    // Money sitting on exchanges = converted but not yet sent to bank
    const drift_to_settle = Math.max(0, total_aed_converted - total_wio_deposits);

    // Customers
    const customers_count = await this.customerRepo.count();
    const high_risk = await this.customerRepo.count({ where: { risk_level: 'High' } });
    const new_customers_this_month = await this.customerRepo.count({ where: { created_at: Between(monthStart, now) } });

    // Reconciliation health
    const pending_reconciliation = allR.filter((r) => !r.reconciled && r.status !== 'refunded').length;
    const mismatch_count = allR.filter((r) => r.status === 'mismatch').length;

    // Invoices (status uses 'unpaid' / 'paid' / 'void' — no due_date field)
    const invoicesOpen = await this.invoiceRepo.find({ where: { status: 'unpaid' } });
    const open_invoice_value_aed = (await Promise.all(
      invoicesOpen.map((i) => this.fx.convertToAed(i.amount, i.currency)),
    )).reduce((a, b) => a + b, 0);

    // Payroll due — next unpaid run total
    const nextRun = await this.payrollRunRepo.findOne({ where: { status: 'approved' }, order: { period: 'ASC' } });
    const draftRun = await this.payrollRunRepo.findOne({ where: { status: 'draft' }, order: { period: 'ASC' } });
    const payrollDue = nextRun || draftRun;
    const payroll_due_aed = payrollDue ? parseFloat(payrollDue.total_net_aed || '0') : 0;

    // Bank summary (sum of all opening balances by currency, simple placeholder)
    const banks = await this.bankRepo.find({ where: { is_active: true } });
    const bank_balance_aed = await (async () => {
      let total = 0;
      for (const b of banks) {
        const aedRate = await this.fx.convertToAed(b.opening_balance, b.currency);
        total += aedRate;
      }
      return total;
    })();

    // Daily delta vs yesterday
    const daily_delta_pct = yesterdaySalesAed > 0 ? ((dailySalesAed - yesterdaySalesAed) / yesterdaySalesAed) * 100 : null;
    const monthly_delta_pct = prevMonthSalesAed > 0 ? ((monthlySalesAed - prevMonthSalesAed) / prevMonthSalesAed) * 100 : null;

    // 30-day cash flow forecast = burn rate
    const avg_daily_expense_aed = this.sumExpensesAed(yearlyE) / Math.max(1, Math.ceil((now.getTime() - yearStart.getTime()) / (24 * 3600 * 1000)));
    const burn_rate_monthly_aed = avg_daily_expense_aed * 30;

    return {
      // Period sales (AED canonical + per-currency breakdown)
      daily: {
        sales_aed: dailySalesAed,
        count: dailyR.length,
        delta_pct: daily_delta_pct,
        currencies: this.breakdownByCurrency(dailyR),
      },
      monthly: {
        sales_aed: monthlySalesAed,
        expenses_aed: monthlyExpAed,
        profit_aed: monthlySalesAed - monthlyExpAed,
        count: monthlyR.length,
        delta_pct: monthly_delta_pct,
        currencies: this.breakdownByCurrency(monthlyR),
      },
      prev_month: {
        sales_aed: prevMonthSalesAed,
        expenses_aed: prevMonthlyExpAed,
        profit_aed: prevMonthSalesAed - prevMonthlyExpAed,
        count: prevMonthlyR.length,
      },
      yearly: {
        sales_aed: yearlySalesAed,
        expenses_aed: yearlyExpAed,
        gross_profit_aed: yearlySalesAed - yearlyExpAed,
        count: yearlyR.length,
      },
      thirty_day: {
        sales_aed: thirtyDaySalesAed,
        count: thirtyR.length,
        currencies: this.breakdownByCurrency(thirtyR),
      },

      // Treasury / crypto
      treasury: {
        total_crypto_received_usdt: total_crypto_received,
        total_aed_converted,
        total_wio_deposits,
        drift_to_settle,
      },

      // Customers
      customers: { total: customers_count, high_risk, new_this_month: new_customers_this_month },

      // Reconciliation
      reconciliation: { pending: pending_reconciliation, mismatch: mismatch_count },

      // Invoices
      invoices: {
        open_count: invoicesOpen.length,
        open_value_aed: open_invoice_value_aed,
      },

      // Payroll
      payroll: {
        due_aed: payroll_due_aed,
        due_period: payrollDue?.period || null,
        due_status: payrollDue?.status || null,
      },

      // Banks
      banks: {
        active_count: banks.length,
        total_aed: bank_balance_aed,
      },

      // VAT
      vat: {
        threshold_aed: VAT_THRESHOLD_AED,
        ytd_aed: yearlySalesAed,
        pct: Math.min(100, (yearlySalesAed / VAT_THRESHOLD_AED) * 100),
      },

      // Burn rate / runway insight
      cashflow: {
        avg_daily_expense_aed,
        burn_rate_monthly_aed,
      },

      // Meta
      _meta: { generated_at: now.toISOString() },
    };
  }

  async chart() {
    // Last 12 months — group by month and sum the AED-equivalent of each
    // recharge so the trend line is currency-honest.
    const rows = await this.rechargeRepo
      .createQueryBuilder('r')
      .select("TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM')", 'month')
      .addSelect('r.amount', 'amount')
      .addSelect('r.currency', 'currency')
      .where("r.created_at >= NOW() - INTERVAL '12 months'")
      .getRawMany();
    const buckets = new Map<string, { sales_aed: number; count: number }>();
    for (const row of rows) {
      const aed = await this.fx.convertToAed(row.amount, row.currency);
      const slot = buckets.get(row.month) || { sales_aed: 0, count: 0 };
      slot.sales_aed += aed;
      slot.count += 1;
      buckets.set(row.month, slot);
    }
    // Ensure the last 12 months exist even if empty (cleaner chart)
    const now = new Date();
    const out: Array<{ month: string; sales_aed: number; count: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const v = buckets.get(key) || { sales_aed: 0, count: 0 };
      out.push({ month: key, sales_aed: v.sales_aed, count: v.count });
    }
    return out;
  }

  async recent() {
    const recharges = await this.rechargeRepo.find({ order: { created_at: 'DESC' }, take: 10, relations: ['customer'] });
    const compliance = await this.complianceRepo.find({ order: { created_at: 'DESC' }, take: 10 });
    return { recharges, compliance };
  }

  /** Top 5 customers this month by AED-equivalent recharge volume. */
  async topCustomers() {
    const monthStart = startOfMonth();
    const now = new Date();
    const rows = await this.rechargeRepo.find({
      where: { created_at: Between(monthStart, now) },
      relations: ['customer'],
    });
    const byCust = new Map<string, { customer_id: string; name: string; recharges: number; aed: number }>();
    for (const r of rows) {
      const id = r.customer_id;
      const aed = await this.fx.convertToAed(r.amount, r.currency);
      const slot = byCust.get(id) || { customer_id: id, name: r.customer?.full_name || r.magnus_username || '—', recharges: 0, aed: 0 };
      slot.recharges += 1;
      slot.aed += aed;
      byCust.set(id, slot);
    }
    return Array.from(byCust.values()).sort((a, b) => b.aed - a.aed).slice(0, 5);
  }

  // ============================================================
  // Net Worth — CEO snapshot
  // ============================================================

  /**
   * Compute the company's net-worth snapshot in AED:
   *   Assets:
   *     • Bank balances (sum of WIO_BANK ledger amounts, plus opening
   *       balance of any other active bank account).
   *     • Crypto treasury holdings (USDT/BTC/etc still on exchange =
   *       converted treasury value minus what's already been swept to Wio).
   *     • Receivables (open invoices, FX-converted).
   *   Liabilities:
   *     • Outstanding payroll (approved but not paid).
   *     • Outstanding tax (tax_due − tax_paid for unpaid filings).
   *   Returns the structured snapshot. The PDF route renders this directly.
   */
  async netWorth() {
    // --- Assets ---
    const assets: NetWorthLineItem[] = [];

    // 1) Bank balances. Sum WIO_BANK ledger (signed). Other banks default to their opening_balance.
    const banks = await this.bankRepo.find({ where: { is_active: true } });
    const wioRows = await this.ledgerRepo.find({ where: { wallet: 'WIO_BANK' } });
    const wioBalanceAed = wioRows.reduce((s, r) => {
      const aed = parseFloat(r.aed_value_at_event || '0');
      const amount = parseFloat(r.amount || '0');
      // wallet code WIO_BANK rows store AED amounts; aed_value_at_event mirrors |amount|.
      return s + (amount >= 0 ? Math.abs(aed || amount) : -Math.abs(aed || amount));
    }, 0);
    if (banks.length || wioBalanceAed) {
      assets.push({
        label: 'Wio Business Bank (AED)',
        value_aed: Math.max(0, wioBalanceAed),
        detail: `${wioRows.length} ledger event(s)`,
      });
      for (const b of banks) {
        if (/wio/i.test(`${b.name} ${b.bank_name}`)) continue; // already captured
        const aedRate = await this.fx.convertToAed(b.opening_balance, b.currency);
        if (aedRate > 0) {
          assets.push({
            label: `${b.name}${b.bank_name ? ' — ' + b.bank_name : ''} (${b.currency})`,
            value_aed: aedRate,
            detail: 'Opening balance',
          });
        }
      }
    }

    // 2) Crypto treasury — sum of treasury batches NOT yet swept to Wio.
    const treasury = await this.treasuryRepo.find();
    const cryptoStillHeldAed = treasury.reduce((s, t) => {
      const converted = parseFloat(t.aed_received || '0');
      const swept = t.transferred_to_wio ? parseFloat(t.wio_aed_amount || t.aed_received || '0') : 0;
      return s + Math.max(0, converted - swept);
    }, 0);
    const cryptoUsdtPending = treasury
      .filter((t) => !t.aed_received || parseFloat(t.aed_received) === 0)
      .reduce((s, t) => s + parseFloat(t.total_usdt_received || '0'), 0);
    if (cryptoStillHeldAed > 0) {
      assets.push({
        label: 'Crypto Treasury — AED converted, not yet deposited',
        value_aed: cryptoStillHeldAed,
        detail: 'Sitting on exchange awaiting Wio transfer',
      });
    }
    if (cryptoUsdtPending > 0) {
      const usdtAed = await this.fx.convertToAed(cryptoUsdtPending, 'USDT');
      assets.push({
        label: `Crypto Treasury — USDT awaiting conversion`,
        value_aed: usdtAed,
        detail: `${cryptoUsdtPending.toFixed(2)} USDT @ live FX`,
      });
    }

    // 3) Receivables — open invoices.
    const openInvoices = await this.invoiceRepo.find({ where: { status: 'unpaid' } });
    const receivablesAed = (
      await Promise.all(openInvoices.map((i) => this.fx.convertToAed(i.amount, i.currency)))
    ).reduce((a, b) => a + b, 0);
    if (receivablesAed > 0) {
      assets.push({
        label: 'Accounts Receivable',
        value_aed: receivablesAed,
        detail: `${openInvoices.length} open invoice(s)`,
      });
    }

    // --- Liabilities ---
    const liabilities: NetWorthLineItem[] = [];

    // 1) Outstanding payroll — approved but not paid.
    const unpaidRuns = await this.payrollRunRepo.find({ where: [{ status: 'approved' }, { status: 'draft' }] });
    const payrollDueAed = unpaidRuns.reduce((s, r) => s + parseFloat(r.total_net_aed || '0'), 0);
    if (payrollDueAed > 0) {
      liabilities.push({
        label: 'Payroll Outstanding',
        value_aed: payrollDueAed,
        detail: `${unpaidRuns.length} run(s) pending payment`,
      });
    }

    // 2) Outstanding tax — sum of (tax_due − tax_paid) for filings not in 'paid'/'exempt' status.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const taxRows = await this.taxRepo.find();
    let taxOutstanding = 0;
    let overdueCount = 0;
    for (const t of taxRows) {
      const status = ['filed', 'paid', 'exempt'].includes(t.status)
        ? t.status
        : (t.due_date && new Date(t.due_date) < today ? 'overdue' : t.status);
      if (status === 'paid' || status === 'exempt') continue;
      const outstanding = Math.max(0, parseFloat(t.tax_due_aed || '0') - parseFloat(t.tax_paid_aed || '0'));
      if (outstanding > 0) {
        taxOutstanding += outstanding;
        if (status === 'overdue') overdueCount += 1;
      }
    }
    if (taxOutstanding > 0) {
      liabilities.push({
        label: 'Tax Liabilities (VAT + Corporate Tax)',
        value_aed: taxOutstanding,
        detail: overdueCount > 0 ? `${overdueCount} filing(s) overdue` : 'Awaiting due date',
      });
    }

    // YTD performance (recompute lightweight)
    const yearStart = startOfYear();
    const now = new Date();
    const [yearlyR, yearlyE] = await Promise.all([
      this.rechargeRepo.find({ where: { created_at: Between(yearStart, now) } }),
      this.expenseRepo.find({ where: { expense_date: Between(yearStart, now) } }),
    ]);
    const yearlyRevenueAed = await this.sumRechargesAed(yearlyR);
    const yearlyExpenseAed = this.sumExpensesAed(yearlyE);

    // Reconciliation health
    const allRecharges = await this.rechargeRepo.find();
    const pending_recharges = allRecharges.filter((r) => !r.reconciled && r.status !== 'refunded').length;
    const mismatches = allRecharges.filter((r) => r.status === 'mismatch').length;
    const total_aed_converted = treasury.reduce((s, t) => s + parseFloat(t.aed_received || '0'), 0);
    const total_wio_deposits = treasury.filter((t) => t.transferred_to_wio).reduce((s, t) => s + parseFloat(t.wio_aed_amount || t.aed_received || '0'), 0);

    const totalAssets = assets.reduce((s, l) => s + l.value_aed, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.value_aed, 0);

    return {
      as_of: now.toISOString(),
      reference_number: `AXR-NW-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`,
      assets,
      liabilities,
      total_assets_aed: totalAssets,
      total_liabilities_aed: totalLiabilities,
      net_worth_aed: totalAssets - totalLiabilities,
      ytd_revenue_aed: yearlyRevenueAed,
      ytd_expenses_aed: yearlyExpenseAed,
      reconciliation: {
        pending_recharges,
        mismatches,
        open_invoices: openInvoices.length,
        drift_to_settle_aed: Math.max(0, total_aed_converted - total_wio_deposits),
      },
    };
  }

  async netWorthPdf(): Promise<{ filename: string; buffer: Buffer }> {
    const snap = await this.netWorth();
    const branding = (await this.settingsRepo.findOne({ where: { key: 'company_branding' } }))?.value || {};
    const input: NetWorthInput = {
      as_of: new Date(snap.as_of),
      reference_number: snap.reference_number,
      assets: snap.assets,
      liabilities: snap.liabilities,
      reconciliation: snap.reconciliation,
      ytd_revenue_aed: snap.ytd_revenue_aed,
      ytd_expenses_aed: snap.ytd_expenses_aed,
      director_name: branding.director_name,
      director_signature_b64: branding.director_signature,
      company_seal_b64: branding.company_seal,
      company_address: branding.company_address,
      company_trn: branding.company_trn,
      company_license: branding.company_license,
      company_email: branding.company_email,
    };
    const buffer = await renderNetWorthPdf(input);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return { filename: `Axistra-Net-Worth-${stamp}.pdf`, buffer };
  }
}
