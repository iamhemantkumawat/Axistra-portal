import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('magnus_sync_logs')
export class MagnusSyncLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) recharge_id: string;
  @Column({ nullable: true }) magnus_username: string;
  @Column() action: string; // sync_user | add_credit | fetch_cdr | mismatch_detected
  @Column({ default: 'success' }) status: string;
  @Column({ type: 'text', nullable: true }) request_payload: string;
  @Column({ type: 'text', nullable: true }) response_payload: string;
  @Column({ type: 'text', nullable: true }) error_message: string;
  @CreateDateColumn() created_at: Date;
}
