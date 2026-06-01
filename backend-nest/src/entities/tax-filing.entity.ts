import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tax filing — Corporate Tax / VAT / Excise / Other. One row per filing
 * period (e.g. VAT Q1-2026, Corporate Tax 2025). Holds the calendar
 * (due date), state, amounts, and the filed return PDF.
 */
@Entity('tax_filings')
export class TaxFiling {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** corporate_tax | vat | excise | wht | other */
  @Column({ default: 'vat' }) tax_type: string;

  /** Human label e.g. "Q1 2026" or "FY 2025" */
  @Column() period_label: string;

  @Column({ type: 'date', nullable: true }) period_start: Date | null;
  @Column({ type: 'date', nullable: true }) period_end: Date | null;
  @Column({ type: 'date' }) due_date: Date;
  @Column({ type: 'date', nullable: true }) filed_at: Date | null;
  @Column({ type: 'date', nullable: true }) paid_at: Date | null;

  /** upcoming | in_progress | filed | paid | overdue | exempt */
  @Column({ default: 'upcoming' }) status: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) taxable_amount_aed: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) tax_due_aed: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) tax_paid_aed: string;

  @Column({ nullable: true }) reference_number: string;
  @Column({ nullable: true }) trn: string;

  // Optional file attachment (the filed return / receipt)
  @Column({ nullable: true }) file_name: string;
  @Column({ nullable: true }) file_url: string;
  @Column({ nullable: true }) mime_type: string;
  @Column({ type: 'int', default: 0 }) file_size: number;

  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ nullable: true }) created_by: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
