import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('treasury_movements')
export class TreasuryMovement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() recharge_id: string;
  @Column() customer_id: string;
  @Column({ nullable: true }) treasury_batch_id: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 }) total_usdt_received: string;
  @Column({ type: 'text', nullable: true }) source_currency_summary: string;
  @Column({ type: 'text', nullable: true }) source_transaction_details: string;
  @Column({ nullable: true }) receiving_wallet: string;
  @Column({ nullable: true }) receiving_wallet_tag: string;
  @Column({ nullable: true }) receive_tx_hash: string;

  @Column({ default: false }) transferred_to_okx: boolean;
  @Column({ nullable: true }) okx_deposit_tx_hash: string;
  @Column({ nullable: true }) okx_account_reference: string;
  @Column({ nullable: true }) okx_transfer_date: Date;

  @Column({ default: false }) converted_to_aed: boolean;
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) usdt_converted: string;
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true }) okx_conversion_rate: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) aed_received: string;
  @Column({ nullable: true }) conversion_date: Date;

  @Column({ default: false }) transferred_to_wio: boolean;
  @Column({ nullable: true }) wio_bank_reference: string;
  @Column({ nullable: true }) wio_deposit_date: Date;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) wio_aed_amount: string;

  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
}
