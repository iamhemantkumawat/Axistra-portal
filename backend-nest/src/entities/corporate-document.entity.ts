import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Corporate Documents Vault — stores the company's official paperwork
 * (Trade License, MOA, AOA, TRN cert, Lease, Board Resolutions, etc.).
 * Each row carries the source file plus its key dates/references so we
 * can dashboard upcoming expiries.
 */
@Entity('corporate_documents')
export class CorporateDocument {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() title: string;

  /** trade_license | moa | aoa | share_certificate | trn_certificate | lease |
   *  board_resolution | shareholder_resolution | cof | poa | bank_letter | other */
  @Column({ default: 'other' }) doc_type: string;

  @Column({ nullable: true }) reference_number: string;
  @Column({ nullable: true }) issuing_authority: string;

  @Column({ type: 'date', nullable: true }) issued_at: Date | null;
  @Column({ type: 'date', nullable: true }) expires_at: Date | null;

  @Column() file_name: string;
  @Column() file_url: string;
  @Column({ nullable: true }) mime_type: string;
  @Column({ type: 'int', default: 0 }) file_size: number;

  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ nullable: true }) uploaded_by: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
