import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Customer } from './customer.entity';

export type RechargeStatus =
  | 'pending_payment'
  | 'payment_received'
  | 'magnus_credited'
  | 'sent_to_okx'
  | 'converted_to_aed'
  | 'deposited_to_wio'
  | 'fully_reconciled'
  | 'mismatch'
  | 'refunded'
  | 'failed';

@Entity('recharges')
export class Recharge {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ unique: true }) recharge_code: string;

  @Column() customer_id: string;
  @ManyToOne(() => Customer, { eager: false })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ nullable: true }) invoice_id: string;
  @Column({ nullable: true }) invoice_number: string;
  @Column({ nullable: true }) magnus_username: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount: string;
  @Column({ default: 'USD' }) currency: string; // EUR | USD | AED
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 }) crypto_amount: string;
  @Column({ default: 'USDT' }) crypto_coin: string;
  @Column({ default: 'TRC20' }) crypto_network: string;
  @Column({ nullable: true }) wallet_address: string;
  @Column({ nullable: true, unique: false }) tx_hash: string;

  @Column({ default: 'Manual' }) payment_gateway: string; // OxaPay | OKX | Manual
  @Column({ nullable: true }) payment_date: Date;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) magnus_credit_added: string;
  @Column({ nullable: true }) magnus_reference_id: string;
  @Column({ nullable: true }) magnus_credited_at: Date;

  @Column({ default: 'pending_payment' }) status: RechargeStatus;
  @Column({ default: false }) reconciled: boolean;
  @Column({ type: 'text', nullable: true }) reconciliation_note: string;
  @Column({ type: 'text', nullable: true }) admin_notes: string;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
