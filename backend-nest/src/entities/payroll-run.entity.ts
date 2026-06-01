import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * One PayrollRun = one calendar month of salary payments. Each run holds
 * many PayrollItems (one per employee). The run captures the bank account
 * used to pay, the actual paid date (may differ from the period end), and
 * the FX rates locked at approval time.
 */
@Entity('payroll_runs')
export class PayrollRun {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** YYYY-MM — the period the salaries cover. */
  @Column() period: string;

  /** draft | approved | paid | cancelled */
  @Column({ default: 'draft' }) status: string;

  /** Bank account that disbursed the salaries (FK to bank_accounts). */
  @Column({ nullable: true }) paid_from_bank_id: string;

  /** Custom pay date — user picks per run, defaults to 1st of next month. */
  @Column({ type: 'date', nullable: true }) paid_at: Date | null;

  /** Totals (AED equivalent) computed when items change. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) total_gross_aed: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) total_net_aed: string;

  @Column({ nullable: true }) approved_by: string;
  @Column({ type: 'timestamptz', nullable: true }) approved_at: Date | null;

  /** Bank reference / wire ID used on the transfer (free-text). */
  @Column({ nullable: true }) transfer_reference: string;

  /** When approved, snapshot of the Board Resolution PDF path. */
  @Column({ nullable: true }) board_resolution_path: string;

  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
