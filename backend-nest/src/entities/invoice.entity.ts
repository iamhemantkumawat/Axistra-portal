import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ unique: true }) invoice_number: string;

  @Column() customer_id: string;
  @Column({ nullable: true }) recharge_id: string;

  @Column() customer_name: string;
  @Column({ nullable: true }) customer_email: string;
  @Column({ nullable: true }) customer_country: string;
  @Column({ nullable: true }) customer_company: string;

  @Column({ default: 'SaaS Platform Usage Credits' }) service_name: string;
  @Column({
    type: 'text',
    default:
      'Prepaid credits for usage of Axistra cloud software platform and related digital services.',
  })
  service_description: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount: string;
  @Column({ default: 'USD' }) currency: string;

  @Column({ nullable: true }) payment_method: string;
  @Column({ nullable: true }) crypto_coin: string;
  @Column({ nullable: true }) crypto_network: string;
  @Column({ nullable: true }) tx_hash: string;

  @Column({ default: 'unpaid' }) status: string; // unpaid | paid | void
  @Column({ nullable: true }) issued_date: Date;

  @CreateDateColumn() created_at: Date;
}
