import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * One line of a PayrollRun = one employee's salary for that month.
 * `expense_id` is filled when the run is marked "paid" — it points to the
 * auto-generated `expenses` row so the salary flows into P&L.
 */
@Entity('payroll_items')
export class PayrollItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() payroll_run_id: string;
  @Column() employee_id: string;

  /** Snapshot of the employee details at run-creation time (defensive
   * against later edits to the Employee row). */
  @Column() employee_name: string;
  @Column() position: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 }) basic_salary: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) allowances: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) deductions: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) net_salary: string;
  @Column({ default: 'AED' }) currency: string;

  /** FX rate captured at approval time — AED per 1 currency unit. */
  @Column({ type: 'decimal', precision: 18, scale: 6, default: '1' }) fx_rate_to_aed: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) net_salary_aed: string;

  /** Filled when run.status flips to 'paid'. */
  @Column({ nullable: true }) expense_id: string;

  /** Stored salary slip + transfer proof on disk. */
  @Column({ nullable: true }) salary_slip_path: string;
  @Column({ nullable: true }) transfer_proof_path: string;

  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
