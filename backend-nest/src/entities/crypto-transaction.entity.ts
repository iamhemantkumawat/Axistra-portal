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
  @Index() @Column() tx_hash: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  wallet_balance_after: string;
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true }) aed_rate_at_payment: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) aed_value: string;
  @Column({ default: 'received' }) status: string;
  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
}
