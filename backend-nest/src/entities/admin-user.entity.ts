import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users_admin')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() password_hash: string;
  @Column({ default: 'Admin' }) full_name: string;
  @Column({ default: 'admin' }) role: string; // admin | accountant | auditor
  @Column({ default: true }) is_active: boolean;
  @Column({ nullable: true }) last_login_at: Date;
  @Column({ nullable: true }) last_login_ip: string;
  @Column({ default: false }) two_fa_enabled: boolean;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
