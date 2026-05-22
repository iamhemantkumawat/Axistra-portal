import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() first_name: string;
  @Column({ nullable: true }) last_name: string;
  @Index() @Column() email: string;
  @Column({ nullable: true }) company: string;
  @Column({ nullable: true }) phone: string;
  @Column({ type: 'text', nullable: true }) message: string;
  @Column({ default: 'website' }) source: string;
  @Column({ default: 'new' }) status: string; // new | contacted | qualified | converted | rejected
  @Column({ nullable: true }) ip_address: string;
  @CreateDateColumn() created_at: Date;
}
