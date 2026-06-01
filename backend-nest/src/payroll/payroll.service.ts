import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Employee } from '../entities/employee.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollItem } from '../entities/payroll-item.entity';
import { Expense } from '../entities/expense.entity';
import { AppSetting } from '../entities/app-setting.entity';
import { WalletLedger, WalletCode } from '../entities/wallet-ledger.entity';
import { EmploymentChange } from '../entities/employment-change.entity';
import { AuditService } from '../audit/audit.service';
import {
  renderOfferLetterPdf,
  renderBoardResolutionPdf,
  renderSalarySlipPdf,
  renderSalaryRevisionPdf,
  renderPositionChangePdf,
  AcceptanceStamp,
  Branding,
} from './payroll-templates';
import * as crypto from 'crypto';

const PAYROLL_DIR = process.env.PAYROLL_STORAGE_DIR || '/app/backups/payroll';

/**
 * Map a BankAccount row to a wallet_ledger WalletCode so salary payments
 * also debit the user's wallet ledger. Today we ship a single Wio mapping;
 * any non-Wio bank just skips the ledger entry (we still record the Expense).
 */
function bankToWalletCode(bank?: BankAccount | null): WalletCode | null {
  if (!bank) return null;
  const haystack = `${bank.name || ''} ${bank.bank_name || ''}`.toLowerCase();
  if (haystack.includes('wio')) return 'WIO_BANK';
  return null;
}

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    @InjectRepository(BankAccount) private bankRepo: Repository<BankAccount>,
    @InjectRepository(PayrollRun) private runRepo: Repository<PayrollRun>,
    @InjectRepository(PayrollItem) private itemRepo: Repository<PayrollItem>,
    @InjectRepository(Expense) private expRepo: Repository<Expense>,
    @InjectRepository(AppSetting) private settings: Repository<AppSetting>,
    @InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>,
    @InjectRepository(EmploymentChange) private changes: Repository<EmploymentChange>,
    private audit: AuditService,
  ) {
    fs.mkdirSync(PAYROLL_DIR, { recursive: true });
  }

  // -------------------- Branding --------------------

  async getBranding(): Promise<Branding> {
    const row = await this.settings.findOne({ where: { key: 'company_branding' } });
    return row?.value || {};
  }

  async setBranding(input: Partial<Branding>): Promise<Branding> {
    const current = await this.getBranding();
    const merged: Branding = { ...current, ...input };
    await this.settings.save({ key: 'company_branding', value: merged } as AppSetting);
    return merged;
  }

  // -------------------- Employees --------------------

  async nextEmployeeCode(): Promise<string> {
    const rows = await this.empRepo.createQueryBuilder('e')
      .select('e.employee_code', 'employee_code')
      .where('e.employee_code LIKE :p', { p: 'AXE-%' }).getRawMany<{ employee_code: string }>();
    const used = new Set<number>();
    for (const r of rows) {
      const m = String(r.employee_code || '').match(/(\d+)$/);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n += 1;
    return `AXE-${String(n).padStart(5, '0')}`;
  }

  async listEmployees() {
    return this.empRepo.find({ order: { created_at: 'ASC' } });
  }

  async getEmployee(id: string) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Employee not found');
    const items = await this.itemRepo.find({ where: { employee_id: id }, order: { created_at: 'DESC' } });
    const runs = items.length
      ? await this.runRepo.find({ where: items.map((i) => ({ id: i.payroll_run_id })) })
      : [];
    const runMap = new Map(runs.map((r) => [r.id, r]));
    const history = items.map((i) => ({
      ...i,
      run: runMap.get(i.payroll_run_id) || null,
    }));
    return { ...e, history };
  }

  async createEmployee(data: Partial<Employee>, actor?: any) {
    if (!data.full_name) throw new BadRequestException('full_name required');
    if (!data.position) throw new BadRequestException('position required');
    if (!data.monthly_salary) throw new BadRequestException('monthly_salary required');
    if (!data.start_date) throw new BadRequestException('start_date required');
    const code = await this.nextEmployeeCode();
    const saved = await this.empRepo.save(this.empRepo.create({
      ...data,
      employee_code: code,
      salary_currency: data.salary_currency || 'AED',
      status: data.status || 'active',
    }));
    // Record the initial offer as the first row of the employment history.
    await this.changes.save(this.changes.create({
      employee_id: saved.id,
      employee_name: saved.full_name,
      change_type: 'initial_offer',
      effective_date: saved.start_date,
      new_salary: String(saved.monthly_salary),
      salary_currency: saved.salary_currency,
      new_position: saved.position,
      reason: 'Initial employment offer',
      reference_number: `AXR-OFFER-${new Date(saved.start_date).getFullYear()}-${saved.employee_code.replace('AXE-', '')}`,
      sign_token: this.newToken(),
      sign_status: 'pending',
      created_by: actor?.email || null,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_employee', entity_type: 'employee', entity_id: saved.id,
      details: `${saved.employee_code} · ${saved.full_name} · ${saved.position}`,
    });
    return saved;
  }

  async updateEmployee(id: string, data: Partial<Employee>, actor?: any) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException();
    // Generic updates MAY NOT change salary or position — those must go through
    // the dedicated change-salary / change-position endpoints which generate
    // signed letters and an immutable employment_changes row.
    if (data.monthly_salary !== undefined && String(data.monthly_salary) !== String(e.monthly_salary)) {
      throw new BadRequestException('Use the "Change Salary" action to update monthly_salary — it generates a Salary Revision Letter.');
    }
    if (data.position !== undefined && data.position !== e.position) {
      throw new BadRequestException('Use the "Change Position" action to update position — it generates a Position Change Letter.');
    }
    // Whitelist of safe fields that don't touch the contractual terms.
    const safe = ['full_name', 'employer', 'salary_currency', 'start_date', 'end_date', 'status',
                  'email', 'phone', 'nationality', 'passport_no', 'emirates_id',
                  'bank_name', 'bank_iban', 'bank_swift', 'notes'];
    for (const k of safe) if (k in data) (e as any)[k] = (data as any)[k];
    const saved = await this.empRepo.save(e);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_employee', entity_type: 'employee', entity_id: id,
      details: JSON.stringify(data).slice(0, 400),
    });
    return saved;
  }

  async deleteEmployee(id: string, actor?: any) {
    const linked = await this.itemRepo.count({ where: { employee_id: id } });
    if (linked > 0) {
      throw new BadRequestException(`Employee has ${linked} payroll record(s); terminate instead of delete to preserve audit history.`);
    }
    await this.empRepo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_employee', entity_type: 'employee', entity_id: id,
    });
    return { success: true };
  }

  // -------------------- Bank Accounts --------------------

  async listBankAccounts() {
    return this.bankRepo.find({ order: { is_default_payroll: 'DESC', created_at: 'ASC' } });
  }

  async createBankAccount(data: Partial<BankAccount>, actor?: any) {
    if (!data.name) throw new BadRequestException('name required');
    if (data.is_default_payroll) {
      await this.bankRepo.createQueryBuilder().update().set({ is_default_payroll: false }).execute();
    }
    const saved = await this.bankRepo.save(this.bankRepo.create({
      ...data,
      currency: data.currency || 'AED',
      is_active: data.is_active !== false,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_bank_account', entity_type: 'bank_account', entity_id: saved.id,
      details: `${saved.name} (${saved.currency})`,
    });
    return saved;
  }

  async updateBankAccount(id: string, data: Partial<BankAccount>, actor?: any) {
    const b = await this.bankRepo.findOne({ where: { id } });
    if (!b) throw new NotFoundException();
    if (data.is_default_payroll && !b.is_default_payroll) {
      await this.bankRepo.createQueryBuilder().update().set({ is_default_payroll: false }).execute();
    }
    Object.assign(b, data);
    const saved = await this.bankRepo.save(b);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_bank_account', entity_type: 'bank_account', entity_id: id,
    });
    return saved;
  }

  async deleteBankAccount(id: string, actor?: any) {
    const used = await this.runRepo.count({ where: { paid_from_bank_id: id } });
    if (used > 0) {
      throw new BadRequestException(`This bank account is used by ${used} payroll run(s); mark inactive instead of deleting.`);
    }
    await this.bankRepo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_bank_account', entity_type: 'bank_account', entity_id: id,
    });
    return { success: true };
  }

  // -------------------- Payroll Runs --------------------

  async listRuns() {
    const runs = await this.runRepo.find({ order: { period: 'DESC', created_at: 'DESC' } });
    const items = await this.itemRepo.find();
    const banks = await this.bankRepo.find();
    const bankMap = new Map(banks.map((b) => [b.id, b]));
    return runs.map((r) => ({
      ...r,
      items_count: items.filter((i) => i.payroll_run_id === r.id).length,
      paid_from_bank: r.paid_from_bank_id ? bankMap.get(r.paid_from_bank_id) || null : null,
    }));
  }

  async getRun(id: string) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException('Run not found');
    const items = await this.itemRepo.find({ where: { payroll_run_id: id }, order: { employee_name: 'ASC' } });
    const bank = run.paid_from_bank_id ? await this.bankRepo.findOne({ where: { id: run.paid_from_bank_id } }) : null;
    return { ...run, items, paid_from_bank: bank };
  }

  /**
   * Create a run for the given period. Auto-populates a PayrollItem for each
   * ACTIVE employee at their current salary. Idempotent on (period) — re-running
   * returns the existing draft.
   */
  async createRun(data: { period: string; paid_from_bank_id?: string; paid_at?: any; notes?: string }, actor?: any) {
    if (!/^\d{4}-\d{2}$/.test(data.period || '')) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }
    const existing = await this.runRepo.findOne({ where: { period: data.period } });
    if (existing) return this.getRun(existing.id);

    const defaultBank = await this.bankRepo.findOne({ where: { is_default_payroll: true } });
    const employees = await this.empRepo.find({ where: { status: 'active' }, order: { created_at: 'ASC' } });
    if (employees.length === 0) throw new BadRequestException('No active employees to run payroll for');

    const run = await this.runRepo.save(this.runRepo.create({
      period: data.period,
      paid_from_bank_id: data.paid_from_bank_id || defaultBank?.id || null,
      paid_at: data.paid_at ? new Date(data.paid_at) : this.defaultPayDateFor(data.period),
      status: 'draft',
      notes: data.notes,
    }));

    let totalGross = 0;
    let totalNet = 0;
    for (const e of employees) {
      const basic = parseFloat(e.monthly_salary || '0');
      const netAed = basic; // FX = 1 for AED. Non-AED currencies left to user override.
      totalGross += basic;
      totalNet += netAed;
      await this.itemRepo.save(this.itemRepo.create({
        payroll_run_id: run.id,
        employee_id: e.id,
        employee_name: e.full_name,
        position: e.position,
        basic_salary: String(basic),
        allowances: '0',
        deductions: '0',
        net_salary: String(basic),
        currency: e.salary_currency || 'AED',
        fx_rate_to_aed: '1',
        net_salary_aed: String(netAed),
      }));
    }
    run.total_gross_aed = String(totalGross);
    run.total_net_aed = String(totalNet);
    await this.runRepo.save(run);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_payroll_run', entity_type: 'payroll_run', entity_id: run.id,
      details: `Created ${run.period} draft for ${employees.length} employees`,
    });
    return this.getRun(run.id);
  }

  private defaultPayDateFor(period: string): Date {
    // First of the NEXT month.
    const [y, m] = period.split('-').map((s) => parseInt(s, 10));
    if (m === 12) return new Date(y + 1, 0, 1);
    return new Date(y, m, 1);
  }

  async updateRun(id: string, data: Partial<PayrollRun>, actor?: any) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException();
    if (run.status === 'paid') throw new BadRequestException('Paid runs are locked. Add a correction run.');
    const allowed = ['paid_from_bank_id', 'paid_at', 'notes', 'transfer_reference'];
    for (const k of allowed) if (k in data) (run as any)[k] = (data as any)[k];
    if (run.paid_at && typeof run.paid_at === 'string') run.paid_at = new Date(run.paid_at);
    const saved = await this.runRepo.save(run);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_payroll_run', entity_type: 'payroll_run', entity_id: id,
    });
    return saved;
  }

  async updateItem(id: string, data: Partial<PayrollItem>, actor?: any) {
    const item = await this.itemRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException();
    const run = await this.runRepo.findOne({ where: { id: item.payroll_run_id } });
    if (run?.status === 'paid') throw new BadRequestException('Item is locked — its run is already paid');

    const allowed = ['basic_salary', 'allowances', 'deductions', 'fx_rate_to_aed', 'currency', 'notes'];
    for (const k of allowed) if (k in data) (item as any)[k] = (data as any)[k];
    const basic = parseFloat(item.basic_salary);
    const a = parseFloat(item.allowances || '0') || 0;
    const d = parseFloat(item.deductions || '0') || 0;
    const net = basic + a - d;
    const fx = parseFloat(item.fx_rate_to_aed || '1') || 1;
    item.net_salary = String(net);
    item.net_salary_aed = String(net * fx);
    await this.itemRepo.save(item);
    await this.recalcRunTotals(item.payroll_run_id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_payroll_item', entity_type: 'payroll_item', entity_id: id,
    });
    return item;
  }

  private async recalcRunTotals(runId: string) {
    const items = await this.itemRepo.find({ where: { payroll_run_id: runId } });
    const gross = items.reduce((acc, i) => acc + parseFloat(i.basic_salary || '0'), 0);
    const net = items.reduce((acc, i) => acc + parseFloat(i.net_salary_aed || '0'), 0);
    await this.runRepo.update(runId, { total_gross_aed: String(gross), total_net_aed: String(net) });
  }

  async approveRun(id: string, actor?: any) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException();
    if (run.status !== 'draft') throw new BadRequestException(`Cannot approve a ${run.status} run`);

    // Auto-render Board Resolution PDF and attach to the run.
    const items = await this.itemRepo.find({ where: { payroll_run_id: id } });
    const branding = await this.getBranding();
    const pdf = await renderBoardResolutionPdf({
      effective_date: this.periodStart(run.period),
      resolution_date: new Date(),
      rows: items.map((i) => ({
        employee_name: i.employee_name,
        position: i.position,
        monthly_salary: i.basic_salary,
        currency: i.currency,
      })),
      resolution_number: `AXR-${run.period}-001`,
    }, branding);
    const dir = path.join(PAYROLL_DIR, run.id);
    fs.mkdirSync(dir, { recursive: true });
    const pdfPath = path.join(dir, `board-resolution-${run.period}.pdf`);
    fs.writeFileSync(pdfPath, pdf);

    run.status = 'approved';
    run.approved_at = new Date();
    run.approved_by = actor?.email || null;
    run.board_resolution_path = pdfPath;
    await this.runRepo.save(run);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'approve_payroll_run', entity_type: 'payroll_run', entity_id: id,
      details: `Approved ${run.period} · ${items.length} items · total AED ${run.total_net_aed}`,
    });
    return this.getRun(id);
  }

  private periodStart(period: string): Date {
    const [y, m] = period.split('-').map((s) => parseInt(s, 10));
    return new Date(y, m - 1, 1);
  }

  /**
   * Mark run as paid: auto-creates one Expense per item (so P&L reflects),
   * and auto-renders signed salary slips for each item.
   */
  async markRunPaid(id: string, data: { paid_at?: any; transfer_reference?: string }, actor?: any) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException();
    if (run.status === 'paid') return this.getRun(id);
    if (run.status === 'cancelled') throw new BadRequestException('Run is cancelled');
    if (run.status === 'draft') throw new BadRequestException('Approve the run before marking paid');

    if (data.paid_at) run.paid_at = new Date(data.paid_at);
    if (data.transfer_reference !== undefined) run.transfer_reference = data.transfer_reference;
    if (!run.paid_at) run.paid_at = new Date();

    const bank = run.paid_from_bank_id ? await this.bankRepo.findOne({ where: { id: run.paid_from_bank_id } }) : null;
    const walletCode = bankToWalletCode(bank);
    const items = await this.itemRepo.find({ where: { payroll_run_id: id } });
    const branding = await this.getBranding();
    const dir = path.join(PAYROLL_DIR, run.id);
    fs.mkdirSync(dir, { recursive: true });

    for (const item of items) {
      // Create the matching Expense row (so the salary flows into P&L).
      const exp = await this.expRepo.save(this.expRepo.create({
        expense_date: run.paid_at,
        vendor_name: item.employee_name,
        category: 'Salary',
        amount: item.net_salary_aed,
        currency: 'AED',
        payment_method: 'Bank',
        bank_name: bank?.bank_name || bank?.name || null,
        bank_reference: run.transfer_reference || `Salary ${this.periodLabel(run.period)} — ${item.employee_name}`,
        notes: `Auto-created by Payroll Run ${run.period} (${run.id}). Item ${item.id}.`,
      }));
      item.expense_id = exp.id;

      // Mirror the salary as a debit on the paying wallet/bank ledger so the
      // Wallet Ledger balance updates in real time. Only do this when the
      // bank account maps to a known wallet code (currently Wio only).
      if (walletCode) {
        await this.ledger.save(this.ledger.create({
          wallet: walletCode,
          coin: 'AED',
          amount: `-${item.net_salary_aed}`,
          tx_type: 'expense',
          external_ref: `PAY-${run.period}-${item.employee_name.replace(/\s+/g, '_')}`,
          counterparty: item.employee_name,
          linked_expense_id: exp.id,
          aed_value_at_event: item.net_salary_aed,
          notes: `Salary ${this.periodLabel(run.period)} — ${item.employee_name} (run ${run.id})`,
          actor_email: actor?.email,
          event_at: run.paid_at,
        }));
      }

      // Render & store the signed salary slip.
      const slip = await renderSalarySlipPdf({
        employee_name: item.employee_name,
        position: item.position,
        period_label: this.periodLabel(run.period),
        paid_at: run.paid_at,
        basic_salary: item.basic_salary,
        allowances: item.allowances,
        deductions: item.deductions,
        net_salary: item.net_salary,
        currency: item.currency,
        bank_name: bank?.bank_name || bank?.name,
        transfer_reference: run.transfer_reference || `Salary ${this.periodLabel(run.period)} — ${item.employee_name}`,
      }, branding);
      const slipPath = path.join(dir, `salary-slip-${run.period}-${item.employee_name.replace(/\s+/g, '_')}.pdf`);
      fs.writeFileSync(slipPath, slip);
      item.salary_slip_path = slipPath;
      await this.itemRepo.save(item);
    }

    run.status = 'paid';
    await this.runRepo.save(run);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'mark_payroll_run_paid', entity_type: 'payroll_run', entity_id: id,
      details: `Paid ${run.period} via ${bank?.name || 'bank'} on ${run.paid_at?.toISOString()}`,
    });
    return this.getRun(id);
  }

  private periodLabel(period: string) {
    const [y, m] = period.split('-').map((s) => parseInt(s, 10));
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[m - 1]} ${y}`;
  }

  async cancelRun(id: string, actor?: any) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException();
    if (run.status === 'paid') throw new BadRequestException('Paid runs cannot be cancelled — file a correction');
    run.status = 'cancelled';
    await this.runRepo.save(run);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'cancel_payroll_run', entity_type: 'payroll_run', entity_id: id,
    });
    return this.getRun(id);
  }

  /**
   * Backfill wallet_ledger debits for already-PAID payroll runs that were
   * marked paid before the ledger-integration existed. Idempotent: skips
   * items that already have a ledger entry linked to their expense_id.
   */
  async syncPaidRunsToLedger(actor?: any) {
    const paidRuns = await this.runRepo.find({ where: { status: 'paid' } });
    let created = 0;
    let skipped = 0;
    for (const run of paidRuns) {
      const bank = run.paid_from_bank_id ? await this.bankRepo.findOne({ where: { id: run.paid_from_bank_id } }) : null;
      const walletCode = bankToWalletCode(bank);
      if (!walletCode) { skipped += 1; continue; }
      const items = await this.itemRepo.find({ where: { payroll_run_id: run.id } });
      for (const item of items) {
        if (!item.expense_id) { skipped += 1; continue; }
        const exists = await this.ledger.findOne({ where: { linked_expense_id: item.expense_id } });
        if (exists) { skipped += 1; continue; }
        await this.ledger.save(this.ledger.create({
          wallet: walletCode,
          coin: 'AED',
          amount: `-${item.net_salary_aed}`,
          tx_type: 'expense',
          external_ref: `PAY-${run.period}-${item.employee_name.replace(/\s+/g, '_')}`,
          counterparty: item.employee_name,
          linked_expense_id: item.expense_id,
          aed_value_at_event: item.net_salary_aed,
          notes: `Salary ${this.periodLabel(run.period)} — ${item.employee_name} (backfilled from run ${run.id})`,
          actor_email: actor?.email,
          event_at: run.paid_at || new Date(),
        }));
        created += 1;
      }
    }
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'sync_payroll_to_ledger', entity_type: 'payroll_run', entity_id: 'bulk',
      details: `Backfill: created ${created} ledger row(s), skipped ${skipped}`,
    });
    return { created, skipped };
  }

  // -------------------- File outputs --------------------

  /**
   * Returns the most relevant employment letter for this employee:
   *
   *   • If the employee has had no salary revisions → render the original
   *     **Offer Letter** with the original hire date + original salary.
   *   • If the employee has had one or more salary revisions → render the
   *     **latest Salary Revision Letter** so the date and salary on the
   *     downloaded PDF stay in sync with the current salary shown in the
   *     UI. This is what the user wanted: clicking the offer icon should
   *     never display "new salary, old date".
   */
  async employeeOfferLetterPdf(employeeId: string): Promise<{ filename: string; buffer: Buffer }> {
    const e = await this.empRepo.findOne({ where: { id: employeeId } });
    if (!e) throw new NotFoundException();
    const branding = await this.getBranding();

    // Look up the latest salary_change for this employee, if any.
    const latestRevision = await this.changes.findOne({
      where: { employee_id: employeeId, change_type: 'salary_change' },
      order: { created_at: 'DESC' },
    });

    if (latestRevision) {
      // Reuse the salary-revision template so the letter date, effective
      // date and salary all match the most recent change. The optional
      // employee back-sign stamp is included when present.
      const acceptance: AcceptanceStamp | undefined =
        latestRevision.sign_status === 'agreed' || latestRevision.sign_status === 'declined'
          ? {
            status: latestRevision.sign_status as 'agreed' | 'declined',
            employee_signature: latestRevision.sign_payload || latestRevision.employee_name,
            signature_method: (latestRevision.sign_method as 'typed' | 'drawn') || 'typed',
            signed_at: latestRevision.signed_at,
            sign_ip: latestRevision.sign_ip || undefined,
            decline_note: latestRevision.sign_decline_note || undefined,
          }
          : undefined;

      const buf = await renderSalaryRevisionPdf({
        employee_name: latestRevision.employee_name,
        employee_code: e.employee_code,
        position: latestRevision.new_position || e.position,
        old_salary: latestRevision.old_salary || '0',
        new_salary: latestRevision.new_salary || String(e.monthly_salary),
        currency: latestRevision.salary_currency || e.salary_currency || 'AED',
        effective_date: latestRevision.effective_date,
        letter_date: latestRevision.created_at,
        reference_number: latestRevision.reference_number || undefined,
        original_offer_date: e.start_date,
        reason: latestRevision.reason || undefined,
        acceptance,
      }, branding);
      return {
        filename: `salary-revision-${e.full_name.replace(/\s+/g, '_')}-${latestRevision.reference_number || latestRevision.id.slice(0, 8)}.pdf`,
        buffer: buf,
      };
    }

    // No revisions on file → fall back to the original Offer Letter.
    const buf = await renderOfferLetterPdf({
      employee_name: e.full_name,
      position: e.position,
      monthly_salary: e.monthly_salary,
      currency: e.salary_currency,
      start_date: e.start_date,
      letter_date: e.start_date,
      employer: e.employer,
    }, branding);
    return { filename: `offer-letter-${e.full_name.replace(/\s+/g, '_')}.pdf`, buffer: buf };
  }

  async runResolutionPdf(runId: string): Promise<{ filename: string; buffer: Buffer }> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException();
    if (run.board_resolution_path && fs.existsSync(run.board_resolution_path)) {
      return { filename: `board-resolution-${run.period}.pdf`, buffer: fs.readFileSync(run.board_resolution_path) };
    }
    const items = await this.itemRepo.find({ where: { payroll_run_id: runId } });
    const branding = await this.getBranding();
    const buf = await renderBoardResolutionPdf({
      effective_date: this.periodStart(run.period),
      resolution_date: new Date(),
      rows: items.map((i) => ({ employee_name: i.employee_name, position: i.position, monthly_salary: i.basic_salary, currency: i.currency })),
      resolution_number: `AXR-${run.period}-001`,
    }, branding);
    return { filename: `board-resolution-${run.period}.pdf`, buffer: buf };
  }

  async itemSalarySlipPdf(itemId: string): Promise<{ filename: string; buffer: Buffer }> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException();
    const run = await this.runRepo.findOne({ where: { id: item.payroll_run_id } });
    if (item.salary_slip_path && fs.existsSync(item.salary_slip_path)) {
      return { filename: path.basename(item.salary_slip_path), buffer: fs.readFileSync(item.salary_slip_path) };
    }
    const bank = run?.paid_from_bank_id ? await this.bankRepo.findOne({ where: { id: run.paid_from_bank_id } }) : null;
    const branding = await this.getBranding();
    const buf = await renderSalarySlipPdf({
      employee_name: item.employee_name,
      position: item.position,
      period_label: this.periodLabel(run?.period || 'YYYY-MM'),
      paid_at: run?.paid_at || new Date(),
      basic_salary: item.basic_salary,
      allowances: item.allowances,
      deductions: item.deductions,
      net_salary: item.net_salary,
      currency: item.currency,
      bank_name: bank?.bank_name || bank?.name,
      transfer_reference: run?.transfer_reference,
    }, branding);
    return { filename: `salary-slip-${run?.period}-${item.employee_name.replace(/\s+/g, '_')}.pdf`, buffer: buf };
  }

  /** Payroll register: full history Excel (cumulative). */
  async payrollRegisterXlsx(): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payroll Register');
    ws.columns = [
      { header: 'Month',        key: 'period',  width: 12 },
      { header: 'Pay Date',     key: 'paid_at', width: 14 },
      { header: 'Employee Code',key: 'code',    width: 14 },
      { header: 'Employee',     key: 'name',    width: 28 },
      { header: 'Position',     key: 'pos',     width: 24 },
      { header: 'Basic',        key: 'basic',   width: 14 },
      { header: 'Allowances',   key: 'allow',   width: 12 },
      { header: 'Deductions',   key: 'ded',     width: 12 },
      { header: 'Net (AED)',    key: 'net',     width: 14 },
      { header: 'Bank',         key: 'bank',    width: 18 },
      { header: 'Reference',    key: 'ref',     width: 26 },
      { header: 'Status',       key: 'status',  width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    const runs = await this.runRepo.find({ order: { period: 'ASC' } });
    const items = await this.itemRepo.find();
    const emps = await this.empRepo.find();
    const banks = await this.bankRepo.find();
    const empMap = new Map(emps.map((e) => [e.id, e]));
    const bankMap = new Map(banks.map((b) => [b.id, b]));
    for (const r of runs) {
      const rs = items.filter((i) => i.payroll_run_id === r.id).sort((a, b) => a.employee_name.localeCompare(b.employee_name));
      const bank = r.paid_from_bank_id ? bankMap.get(r.paid_from_bank_id) : null;
      for (const i of rs) {
        const e = empMap.get(i.employee_id);
        ws.addRow({
          period: r.period,
          paid_at: r.paid_at ? new Date(r.paid_at) : '',
          code: e?.employee_code || '',
          name: i.employee_name,
          pos: i.position,
          basic: parseFloat(i.basic_salary),
          allow: parseFloat(i.allowances || '0'),
          ded: parseFloat(i.deductions || '0'),
          net: parseFloat(i.net_salary_aed),
          bank: bank?.name || '',
          ref: r.transfer_reference || '',
          status: r.status,
        });
      }
    }
    // Format money columns
    ['F', 'G', 'H', 'I'].forEach((col) => { ws.getColumn(col).numFmt = '#,##0.00'; });
    ws.getColumn('B').numFmt = 'yyyy-mm-dd';

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // -------------------- File uploads (transfer proofs) --------------------

  async uploadTransferProof(itemId: string, file: { originalname: string; buffer: Buffer; mimetype: string }, actor?: any) {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException();
    const dir = path.join(PAYROLL_DIR, item.payroll_run_id);
    fs.mkdirSync(dir, { recursive: true });
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(dir, `proof-${item.id}-${safeName}`);
    fs.writeFileSync(filePath, file.buffer);
    item.transfer_proof_path = filePath;
    await this.itemRepo.save(item);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'upload_payroll_proof', entity_type: 'payroll_item', entity_id: itemId,
      details: `${file.originalname} (${file.buffer.length} bytes)`,
    });
    return { ok: true, path: filePath };
  }

  async transferProofFile(itemId: string): Promise<{ filename: string; buffer: Buffer; mime: string } | null> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item || !item.transfer_proof_path || !fs.existsSync(item.transfer_proof_path)) return null;
    const mime = item.transfer_proof_path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
    return {
      filename: path.basename(item.transfer_proof_path),
      buffer: fs.readFileSync(item.transfer_proof_path),
      mime,
    };
  }

  // -------------------- Employment changes & signing --------------------

  private newToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private async nextChangeRef(prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.changes.createQueryBuilder('c')
      .select('c.reference_number', 'reference_number')
      .where('c.reference_number LIKE :p', { p: `AXR-${prefix}-${year}-%` })
      .getRawMany<{ reference_number: string }>();
    const used = new Set<number>();
    for (const r of rows) {
      const m = String(r.reference_number || '').match(/(\d+)$/);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n += 1;
    return `AXR-${prefix}-${year}-${String(n).padStart(3, '0')}`;
  }

  async listChangesForEmployee(employeeId: string) {
    const rows = await this.changes.find({
      where: { employee_id: employeeId },
      order: { effective_date: 'DESC', created_at: 'DESC' },
    });
    // Strip sign_token from the response — tokens leak via the public link only.
    return rows.map(({ sign_token, ...rest }) => ({
      ...rest,
      has_sign_token: !!sign_token,
    }));
  }

  /**
   * Record a salary change → update employee, write history row, generate a
   * signed Salary Revision Letter PDF, return a fresh sign URL/token.
   */
  async changeSalary(
    employeeId: string,
    body: { new_salary: number | string; effective_date: any; reason?: string },
    actor?: any,
  ) {
    const e = await this.empRepo.findOne({ where: { id: employeeId } });
    if (!e) throw new NotFoundException('Employee not found');
    if (!body.new_salary || isNaN(Number(body.new_salary))) {
      throw new BadRequestException('new_salary required');
    }
    if (!body.effective_date) throw new BadRequestException('effective_date required');
    const oldSalary = String(e.monthly_salary);
    if (String(body.new_salary) === oldSalary) {
      throw new BadRequestException('New salary is identical to current salary');
    }

    const ref = await this.nextChangeRef('SAL');
    const change = await this.changes.save(this.changes.create({
      employee_id: e.id,
      employee_name: e.full_name,
      change_type: 'salary_change',
      effective_date: new Date(body.effective_date),
      old_salary: oldSalary,
      new_salary: String(body.new_salary),
      salary_currency: e.salary_currency,
      old_position: e.position,
      new_position: e.position,
      reason: body.reason || null,
      reference_number: ref,
      sign_token: this.newToken(),
      sign_status: 'pending',
      created_by: actor?.email || null,
    }));

    // Update the Employee row to the new salary so payroll runs from now on
    // use the revised figure.
    e.monthly_salary = String(body.new_salary);
    await this.empRepo.save(e);

    await this.regenerateChangeLetter(change.id);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'change_salary', entity_type: 'employee', entity_id: e.id,
      details: `${ref} · ${e.salary_currency} ${oldSalary} → ${body.new_salary}, effective ${body.effective_date}`,
    });
    return this.getChange(change.id);
  }

  /** Record a position change with letter + signing token. */
  async changePosition(
    employeeId: string,
    body: { new_position: string; effective_date: any; reason?: string },
    actor?: any,
  ) {
    const e = await this.empRepo.findOne({ where: { id: employeeId } });
    if (!e) throw new NotFoundException('Employee not found');
    if (!body.new_position) throw new BadRequestException('new_position required');
    if (!body.effective_date) throw new BadRequestException('effective_date required');
    if (body.new_position === e.position) {
      throw new BadRequestException('New position is identical to current position');
    }

    const ref = await this.nextChangeRef('POS');
    const change = await this.changes.save(this.changes.create({
      employee_id: e.id,
      employee_name: e.full_name,
      change_type: 'position_change',
      effective_date: new Date(body.effective_date),
      old_position: e.position,
      new_position: body.new_position,
      old_salary: String(e.monthly_salary),
      new_salary: String(e.monthly_salary),
      salary_currency: e.salary_currency,
      reason: body.reason || null,
      reference_number: ref,
      sign_token: this.newToken(),
      sign_status: 'pending',
      created_by: actor?.email || null,
    }));

    e.position = body.new_position;
    await this.empRepo.save(e);
    await this.regenerateChangeLetter(change.id);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'change_position', entity_type: 'employee', entity_id: e.id,
      details: `${ref} · ${change.old_position} → ${body.new_position}, effective ${body.effective_date}`,
    });
    return this.getChange(change.id);
  }

  /** Return one change + linked PDF info, optionally hiding the sign_token. */
  async getChange(changeId: string) {
    const c = await this.changes.findOne({ where: { id: changeId } });
    if (!c) throw new NotFoundException('Change not found');
    const e = await this.empRepo.findOne({ where: { id: c.employee_id } });
    const { sign_token, ...rest } = c;
    return {
      ...rest,
      has_sign_token: !!sign_token,
      sign_url_path: sign_token ? `/sign/${sign_token}` : null,
      employee: e ? { id: e.id, employee_code: e.employee_code, full_name: e.full_name, position: e.position } : null,
    };
  }

  /** Letter PDF for a change row (idempotent — regenerates if missing). */
  async changeLetterPdf(changeId: string): Promise<{ filename: string; buffer: Buffer }> {
    const c = await this.changes.findOne({ where: { id: changeId } });
    if (!c) throw new NotFoundException();
    if (!c.letter_path || !fs.existsSync(c.letter_path)) {
      await this.regenerateChangeLetter(changeId);
    }
    const fresh = await this.changes.findOne({ where: { id: changeId } });
    return {
      filename: path.basename(fresh!.letter_path!),
      buffer: fs.readFileSync(fresh!.letter_path!),
    };
  }

  /**
   * Regenerate the letter PDF for a given change row. Used after creation
   * AND after the employee back-signs (to embed the acceptance stamp).
   */
  private async regenerateChangeLetter(changeId: string) {
    const c = await this.changes.findOne({ where: { id: changeId } });
    if (!c) return;
    const e = await this.empRepo.findOne({ where: { id: c.employee_id } });
    const branding = await this.getBranding();
    const dir = path.join(PAYROLL_DIR, 'employees', c.employee_id);
    fs.mkdirSync(dir, { recursive: true });

    const acceptance: AcceptanceStamp | undefined = c.sign_status === 'agreed' || c.sign_status === 'declined'
      ? {
        status: c.sign_status as 'agreed' | 'declined',
        employee_signature: c.sign_payload || c.employee_name,
        signature_method: (c.sign_method as 'typed' | 'drawn') || 'typed',
        signed_at: c.signed_at,
        sign_ip: c.sign_ip || undefined,
        decline_note: c.sign_decline_note || undefined,
      }
      : undefined;

    let buffer: Buffer;
    let filename: string;
    if (c.change_type === 'salary_change') {
      buffer = await renderSalaryRevisionPdf({
        employee_name: c.employee_name,
        employee_code: e?.employee_code,
        position: c.new_position || e?.position || '',
        old_salary: c.old_salary || '0',
        new_salary: c.new_salary || '0',
        currency: c.salary_currency || 'AED',
        effective_date: c.effective_date,
        letter_date: c.created_at,
        reference_number: c.reference_number || undefined,
        original_offer_date: e?.start_date,
        reason: c.reason || undefined,
        acceptance,
      }, branding);
      filename = `salary-revision-${c.reference_number}.pdf`;
    } else if (c.change_type === 'position_change') {
      buffer = await renderPositionChangePdf({
        employee_name: c.employee_name,
        employee_code: e?.employee_code,
        old_position: c.old_position || '',
        new_position: c.new_position || '',
        effective_date: c.effective_date,
        letter_date: c.created_at,
        reference_number: c.reference_number || undefined,
        reason: c.reason || undefined,
        acceptance,
      }, branding);
      filename = `position-change-${c.reference_number}.pdf`;
    } else if (c.change_type === 'initial_offer') {
      // The initial offer letter is generated on-the-fly by employeeOfferLetterPdf()
      // so we don't need to write a duplicate to disk here.
      return;
    } else {
      return;
    }
    const p = path.join(dir, filename);
    fs.writeFileSync(p, buffer);
    c.letter_path = p;
    await this.changes.save(c);
  }

  // ---------- Public back-signing flow ----------

  /** Public-facing: fetch the letter content + status by token. */
  async getSignDocument(token: string) {
    const c = await this.changes.findOne({ where: { sign_token: token } });
    if (!c) throw new NotFoundException('Invalid signing link');
    const e = await this.empRepo.findOne({ where: { id: c.employee_id } });
    const branding = await this.getBranding();
    return {
      change_id: c.id,
      reference_number: c.reference_number,
      change_type: c.change_type,
      effective_date: c.effective_date,
      employee_name: c.employee_name,
      employee_code: e?.employee_code,
      position: c.new_position || e?.position,
      old_salary: c.old_salary,
      new_salary: c.new_salary,
      salary_currency: c.salary_currency,
      old_position: c.old_position,
      new_position: c.new_position,
      reason: c.reason,
      sign_status: c.sign_status,
      signed_at: c.signed_at,
      employer: 'AXISTRA TECHNOLOGIES — FZCO',
      director_name: branding.director_name || 'Hemant Kumawat',
    };
  }

  /** Public-facing: submit the employee's decision + signature payload. */
  async submitSignDecision(
    token: string,
    body: { decision: 'agreed' | 'declined'; signature?: string; signature_method?: 'typed' | 'drawn'; decline_note?: string },
    ip?: string,
    userAgent?: string,
  ) {
    const c = await this.changes.findOne({ where: { sign_token: token } });
    if (!c) throw new NotFoundException('Invalid signing link');
    if (c.sign_status === 'agreed' || c.sign_status === 'declined') {
      throw new BadRequestException(`This letter has already been ${c.sign_status} on ${c.signed_at}`);
    }
    if (!['agreed', 'declined'].includes(body.decision)) {
      throw new BadRequestException('decision must be "agreed" or "declined"');
    }
    if (body.decision === 'agreed' && !body.signature) {
      throw new BadRequestException('signature required to agree');
    }

    c.sign_status = body.decision;
    c.signed_at = new Date();
    c.sign_ip = ip || null;
    c.sign_user_agent = userAgent || null;
    c.sign_payload = body.signature || c.employee_name;
    c.sign_method = body.signature_method === 'drawn' ? 'drawn' : 'typed';
    c.sign_decline_note = body.decline_note || null;
    await this.changes.save(c);
    await this.regenerateChangeLetter(c.id);

    await this.audit.log({
      action: `employee_${body.decision}_change`,
      actor_email: c.employee_name,
      entity_type: 'employment_change',
      entity_id: c.id,
      details: `${c.reference_number} signed ${body.decision} from ${ip || 'unknown'}`,
      ip_address: ip,
    });

    return { ok: true, status: c.sign_status, signed_at: c.signed_at };
  }

  /** Admin-only: rotate the sign_token (in case the previous link leaked). */
  async rotateSignToken(changeId: string, actor?: any) {
    const c = await this.changes.findOne({ where: { id: changeId } });
    if (!c) throw new NotFoundException();
    if (c.sign_status === 'agreed' || c.sign_status === 'declined') {
      throw new BadRequestException('Already signed — cannot rotate token');
    }
    c.sign_token = this.newToken();
    await this.changes.save(c);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'rotate_sign_token', entity_type: 'employment_change', entity_id: changeId,
    });
    return this.getChange(changeId);
  }

  // -------------------- Seed (one-shot) --------------------

  /** Seed Hemant + Sanjana + May 2026 draft run if portal is empty. */
  async seedIfEmpty() {
    const existing = await this.empRepo.count();
    if (existing > 0) return { seeded: false, reason: 'employees already exist' };

    const hemant = await this.createEmployee({
      full_name: 'Hemant Kumawat',
      position: 'Director & CEO',
      monthly_salary: '20000',
      salary_currency: 'AED',
      start_date: new Date('2026-05-01'),
      status: 'active',
    } as any);
    const sanjana = await this.createEmployee({
      full_name: 'Sanjana Kumawat',
      position: 'Operations Manager',
      monthly_salary: '15000',
      salary_currency: 'AED',
      start_date: new Date('2026-05-01'),
      status: 'active',
    } as any);

    // Default Wio bank (only if no bank rows yet).
    if ((await this.bankRepo.count()) === 0) {
      await this.createBankAccount({
        name: 'Wio Business — AED',
        bank_name: 'Wio Bank',
        currency: 'AED',
        is_default_payroll: true,
      } as any);
    }

    const run = await this.createRun({ period: '2026-05' });
    return { seeded: true, employees: [hemant, sanjana], run_id: run.id };
  }
}
