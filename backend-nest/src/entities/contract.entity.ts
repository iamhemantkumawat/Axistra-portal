import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Contracts Vault — customer agreements, NDAs, supplier contracts,
 * employment contracts. Soft FK to customers via `customer_id` keeps the
 * vault searchable without forcing every contract to be customer-linked.
 */
@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() title: string;

  /** customer_agreement | nda | supplier | employment | service | other */
  @Column({ default: 'customer_agreement' }) contract_type: string;

  @Column({ nullable: true }) counterparty_name: string;
  @Column({ nullable: true }) customer_id: string;
  @Column({ nullable: true }) reference_number: string;

  @Column({ type: 'date', nullable: true }) signed_at: Date | null;
  @Column({ type: 'date', nullable: true }) start_date: Date | null;
  @Column({ type: 'date', nullable: true }) end_date: Date | null;

  /** draft | active | expired | terminated | renewed */
  @Column({ default: 'active' }) status: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: '0' }) contract_value: string;
  @Column({ default: 'AED' }) currency: string;

  // File attachment (the signed PDF)
  @Column({ nullable: true }) file_name: string;
  @Column({ nullable: true }) file_url: string;
  @Column({ nullable: true }) mime_type: string;
  @Column({ type: 'int', default: 0 }) file_size: number;

  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ nullable: true }) created_by: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
