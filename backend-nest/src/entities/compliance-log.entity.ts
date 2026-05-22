import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('compliance_logs')
export class ComplianceLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customer_id: string;
  @Column({ default: 'Low' }) risk_level: string;
  @Column() action: string; // mark_high_risk | request_kyc | block | refund | suspicious_note | document_attached
  @Column({ type: 'text', nullable: true }) notes: string;
  @Column({ default: false }) blocked: boolean;
  @Column({ default: false }) high_volume_flag: boolean;
  @Column({ nullable: true }) refund_amount: string;
  @Column({ nullable: true }) refund_currency: string;
  @Column({ nullable: true }) kyc_requested_at: Date;
  @Column({ nullable: true }) document_url: string;
  @Column({ type: 'text', nullable: true }) admin_comment: string;
  @Column({ nullable: true }) created_by: string;
  @CreateDateColumn() created_at: Date;
}
