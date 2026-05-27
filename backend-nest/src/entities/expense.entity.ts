import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true, unique: true }) expense_code: string;
  @Column() expense_date: Date;

  /** Linked vendor row (preferred over free-text vendor_name) */
  @Column({ nullable: true }) vendor_id: string;
  @Column() vendor_name: string;

  @Column() category: string; // VPS | Vendor | Software | Salary | Office | BankCharges | ExchangeFees | Legal | Marketing | Other
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount: string;
  @Column({ default: 'AED' }) currency: string;

  /** Bank | Card | USDT | BinancePay | Cash | Other */
  @Column({ default: 'Bank' }) payment_method: string;

  /** Bank name for Bank/Card payments (e.g. 'Wio Bank') */
  @Column({ nullable: true }) bank_name: string;

  /** Source wallet to debit for USDT / BinancePay payments
   * (BINANCE | OKX | OXAPAY | BTCPAY | WIO_BANK) */
  @Column({ nullable: true }) source_wallet: string;

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
