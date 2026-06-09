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

  // ── Split-recharge support ──────────────────────────────────────────────
  // When the same on-chain TX is shared between N Magnus accounts (e.g.
  // 0.0036 BTC arrives once, split half-half between two customers), every
  // sibling recharge stores the SAME `split_group_id`, its own `split_index`
  // (1-based) and the total `split_total`. The wallet ledger row is created
  // ONCE per group (via the dedupe-by-tx_hash guard) so the bank/exchange
  // balance reflects the actual on-chain receipt — not N copies of it.
  @Index() @Column({ type: 'uuid', nullable: true }) split_group_id: string | null;
  @Column({ type: 'int', nullable: true }) split_index: number | null;
  @Column({ type: 'int', nullable: true }) split_total: number | null;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
