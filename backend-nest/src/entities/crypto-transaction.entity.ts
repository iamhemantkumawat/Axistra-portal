import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('crypto_transactions')
export class CryptoTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() recharge_id: string;
  @Column() customer_id: string;
  @Column({ type: 'decimal', precision: 18, scale: 8 }) crypto_amount: string;
  @Column({ default: 'USDT' }) coin: string;
  @Column({ default: 'TRC20' }) network: string;
  @Column({ nullable: true }) receiving_wallet: string;
  @Column({ nullable: true }) receiving_wallet_tag: string;
  // tx_hash is intentionally NOT unique — split recharges legitimately
  // share one on-chain TX across N customers (each gets their own
  // crypto_transactions row). De-duplication of the actual deposit
  // happens in `wallet_ledgers` via `recordRechargeDeposit`.
  @Index() @Column() tx_hash: string;
  @Column({ nullable: true }) gateway_invoice_id: string;
  @Column({ nullable: true }) gateway_track_id: string;
  @Column({ nullable: true }) gateway_tx_status: string;
  @Column({ nullable: true }) sender_address: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) sent_amount: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) sent_value: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) received_amount: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) received_value: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) gateway_rate: string;
  @Column({ nullable: true }) confirmations: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) auto_convert_amount: string;
  @Column({ nullable: true }) auto_convert_currency: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) final_usdt_amount: string;
  @Column({ type: 'text', nullable: true }) raw_gateway_payload: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  wallet_balance_after: string;
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true }) aed_rate_at_payment: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) aed_value: string;
  @Column({ default: 'received' }) status: string;
  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
}
