import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('treasury_batches')
export class TreasuryBatch {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index() @Column({ unique: true }) batch_code: string;
  @Column() name: string;
  @Column({ nullable: true }) period_start: Date;
  @Column({ nullable: true }) period_end: Date;

  @Column({ default: 'open' }) status: string; // open | ready_to_transfer | sent_to_exchange | received_in_exchange | converted_to_usdt | converted_to_aed | reconciled
  @Column({ nullable: true }) source_gateway: string; // BTCPay | OxaPay | Direct | Mixed
  @Column({ nullable: true }) source_wallet: string;
  @Column({ nullable: true }) destination_exchange: string; // OKX | Binance | Other
  @Column({ nullable: true }) destination_wallet: string;
  @Column({ nullable: true }) settlement_tx_hash: string;
  @Column({ nullable: true }) settlement_reference: string;
  @Column({ nullable: true }) coin: string;
  @Column({ nullable: true }) network: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) total_crypto_amount: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) total_invoice_amount: string;
  @Column({ nullable: true }) invoice_currency: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) transfer_fee_crypto: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) received_crypto_amount: string;
  @Column({ nullable: true }) exchange_received_at: Date;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) usdt_amount: string;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) usdt_conversion_rate: string;
  @Column({ nullable: true }) usdt_conversion_date: Date;
  @Column({ nullable: true }) usdt_conversion_reference: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) crypto_converted: string;
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true }) conversion_rate: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) fiat_received: string;
  @Column({ nullable: true }) fiat_currency: string;
  @Column({ nullable: true }) conversion_date: Date;

  @Column({ nullable: true }) bank_name: string;
  @Column({ nullable: true }) bank_reference: string;
  @Column({ nullable: true }) bank_deposit_date: Date;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) bank_fee_aed: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) net_bank_deposit_amount: string;
  @Column({ type: 'text', nullable: true }) notes: string;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
