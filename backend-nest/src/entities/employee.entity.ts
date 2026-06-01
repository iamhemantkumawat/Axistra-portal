import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Employee on the Axistra payroll. The monthly_salary is the agreed gross
 * payable to the employee in `salary_currency`. A separate FX rate per payroll
 * run lets the company pay an INR contractor while keeping P&L in AED.
 */
@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) employee_code: string; // e.g. AXE-00001

  @Column() full_name: string;
  @Column() position: string;
  @Column({ default: 'AXISTRA TECHNOLOGIES - FZCO' }) employer: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 }) monthly_salary: string;
  @Column({ default: 'AED' }) salary_currency: string;

  @Column({ type: 'date' }) start_date: Date;
  @Column({ type: 'date', nullable: true }) end_date: Date | null;

  /** active | terminated | on_leave */
  @Column({ default: 'active' }) status: string;

  // Personal / banking
  @Column({ nullable: true }) email: string;
  @Column({ nullable: true }) phone: string;
  @Column({ nullable: true }) nationality: string;
  @Column({ nullable: true }) passport_no: string;
  @Column({ nullable: true }) emirates_id: string;
  @Column({ nullable: true }) bank_name: string;
  @Column({ nullable: true }) bank_iban: string;
  @Column({ nullable: true }) bank_swift: string;

  @Column({ type: 'text', nullable: true }) notes: string;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
