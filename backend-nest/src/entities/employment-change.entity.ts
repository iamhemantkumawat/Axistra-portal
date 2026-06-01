import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Immutable log of every contractual change to an employee's terms.
 * One row per event — old/new salary, old/new position, effective date,
 * generated PDF letter path, and the back-signing state from the employee.
 *
 * `change_type`:
 *   - 'initial_offer'    → created automatically when an Employee row is added
 *   - 'salary_change'    → fired ONLY when Director uses the dedicated change-salary action
 *   - 'position_change'  → fired ONLY when Director uses the dedicated change-position action
 *   - 'termination'      → fired when employee status flips to 'terminated'
 */
@Entity('employment_changes')
@Index(['employee_id', 'effective_date'])
export class EmploymentChange {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() employee_id: string;
  @Column() employee_name: string; // snapshot for searchability
  @Column() change_type: string;
  @Column({ type: 'date' }) effective_date: Date;

  // Salary snapshots (string for decimal-safety)
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) old_salary: string | null;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) new_salary: string | null;
  @Column({ nullable: true }) salary_currency: string | null;

  // Position snapshots
  @Column({ nullable: true }) old_position: string | null;
  @Column({ nullable: true }) new_position: string | null;

  @Column({ type: 'text', nullable: true }) reason: string | null;

  // Linked documents
  @Column({ nullable: true }) letter_path: string | null;          // Signed PDF on disk
  @Column({ nullable: true }) board_resolution_path: string | null;
  @Column({ nullable: true }) reference_number: string | null;     // e.g. AXR-SAL-2026-001

  // Back-signing state from the employee
  @Column({ unique: true, nullable: true }) sign_token: string | null;
  @Column({ default: 'pending' }) sign_status: string; // pending | agreed | declined | superseded
  @Column({ type: 'timestamptz', nullable: true }) signed_at: Date | null;
  @Column({ nullable: true }) sign_ip: string | null;
  @Column({ nullable: true }) sign_user_agent: string | null;
  /** Employee's typed name (or base64 of a hand-drawn signature). */
  @Column({ type: 'text', nullable: true }) sign_payload: string | null;
  @Column({ default: 'typed' }) sign_method: string; // typed | drawn
  @Column({ type: 'text', nullable: true }) sign_decline_note: string | null;

  // Audit
  @Column({ nullable: true }) created_by: string | null;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
