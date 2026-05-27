import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ unique: true }) customer_code: string;
  @Column({ nullable: true }) magnus_username: string;
  @Column({ nullable: true }) first_name: string;
  @Column({ nullable: true }) last_name: string;
  @Column() full_name: string;
  @Column({ nullable: true }) company_name: string;
  @Column({ nullable: true }) email: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) telegram: string;
  @Column({ type: 'text', nullable: true }) address: string;
  @Column({ nullable: true }) country: string;
  @Column({ nullable: true }) id_number: string;
  @Column({ nullable: true }) signup_ip: string;
  @Column({ default: 'pending' }) status: string; // pending | active | suspended | blocked
  @Column({ default: 'Low' }) risk_level: string; // Low | Medium | High
  @Column({ default: 'not_required' }) kyc_status: string; // not_required | requested | submitted | approved | rejected
  @Column({ nullable: true }) last_login_at: Date;
  @Column({ type: 'text', nullable: true }) notes: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
