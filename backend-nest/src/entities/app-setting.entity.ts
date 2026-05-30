import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Tiny key-value store for things that don't deserve a dedicated table:
 * Google Drive OAuth tokens, feature flags, last-cron-run timestamps etc.
 *
 * Stored as JSON in the `value` column so the shape can evolve without
 * schema migrations.
 */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn() key: string;
  @Column({ type: 'jsonb' }) value: any;
  @UpdateDateColumn() updated_at: Date;
}
