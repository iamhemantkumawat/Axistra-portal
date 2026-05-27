import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('payment_webhooks')
export class PaymentWebhook {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() source: string; // btcpay | oxapay | telegram_manual | manual
  @Index() @Column({ nullable: true }) external_event_id: string;
  @Index() @Column({ nullable: true }) gateway_invoice_id: string;
  @Index() @Column({ nullable: true }) tx_hash: string;
  @Column({ nullable: true }) recharge_id: string;
  @Column({ default: false }) processed: boolean;
  @Column({ type: 'text', nullable: true }) error_message: string;
  @Column({ type: 'text' }) raw_payload: string;

  @CreateDateColumn() created_at: Date;
}
