import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Vendor / payee directory for expenses (e.g. Voxbeam, hosting providers, …).
 * Reused across expense entries so spend can be aggregated per vendor.
 */
@Entity('vendors')
@Index(['name'], { unique: false })
export class Vendor {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', length: 160 }) name: string;

  /** SaaS | Telecom | VPS | Office | Legal | Bank | Other */
  @Column({ type: 'varchar', length: 60, nullable: true }) type: string;

  /** Free-text contact (email/phone/url) */
  @Column({ type: 'varchar', length: 255, nullable: true }) contact: string;

  /** Default wallet to debit when an expense for this vendor is recorded */
  @Column({ type: 'varchar', length: 24, nullable: true }) default_wallet: string;

  /** Default payment method (Bank | USDT | BinancePay | …) */
  @Column({ type: 'varchar', length: 32, nullable: true }) default_payment_method: string;

  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ default: true }) is_active: boolean;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
