import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('kyc_documents')
export class KycDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customer_id: string;
  @Column() document_type: string; // passport | id | company_doc | address_proof | source_of_funds
  @Column() file_name: string;
  @Column({ nullable: true }) file_url: string;
  @Column({ default: 'submitted' }) status: string; // submitted | approved | rejected
  @Column({ type: 'text', nullable: true }) admin_comment: string;
  @Column({ nullable: true }) reviewed_by: string;
  @Column({ nullable: true }) reviewed_at: Date;
  @CreateDateColumn() created_at: Date;
}
