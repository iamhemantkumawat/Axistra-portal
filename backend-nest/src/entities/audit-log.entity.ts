import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) actor_id: string;
  @Column({ nullable: true }) actor_email: string;
  @Column() action: string;
  @Column({ nullable: true }) entity_type: string;
  @Column({ nullable: true }) entity_id: string;
  @Column({ type: 'text', nullable: true }) details: string;
  @Column({ nullable: true }) ip_address: string;
  @CreateDateColumn() created_at: Date;
}
