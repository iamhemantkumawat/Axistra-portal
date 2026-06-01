import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Operational bank accounts used to pay salaries / vendors / receive customer
 * fiat. Tracked separately from the Wallet Ledger (which is crypto-first).
 * Balance is informational — actual reconciliation comes from imported
 * statements.
 */
@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;                      // "Wio Business — AED"
  @Column({ nullable: true }) bank_name: string; // "Wio Bank"
  @Column({ default: 'AED' }) currency: string;  // AED | USD | EUR | INR
  @Column({ nullable: true }) account_number: string;
  @Column({ nullable: true }) iban: string;
  @Column({ nullable: true }) swift: string;
  @Column({ nullable: true }) branch: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) opening_balance: string;
  @Column({ default: true }) is_active: boolean;
  @Column({ default: false }) is_default_payroll: boolean;
  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
