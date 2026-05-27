import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true, unique: true }) expense_code: string;
  @Column() expense_date: Date;
  @Column() vendor_name: string;
  @Column() category: string; // VPS | Vendor | Software | Salary | Office | BankCharges | ExchangeFees | Legal | Marketing | Other
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount: string;
  @Column({ default: 'AED' }) currency: string;
  @Column({ default: 'Bank' }) payment_method: string; // Bank | Card | USDT | Cash | Other
  @Column({ default: false }) paid_in_usdt: boolean;
  @Column({ nullable: true }) vendor_wallet: string;
  @Column({ nullable: true }) crypto_network: string;
  @Column({ nullable: true }) tx_hash: string;
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true }) aed_rate: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) aed_value: string;
  @Column({ nullable: true }) bank_reference: string;
  @Column({ nullable: true }) receipt_url: string;
  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
}
