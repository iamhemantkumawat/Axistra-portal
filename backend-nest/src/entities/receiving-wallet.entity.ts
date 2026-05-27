import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Receiving wallet addresses owned by Axistra on each exchange/gateway.
 * Used to auto-detect the payment gateway when a recharge wallet_address
 * matches one of these rows (eliminates "mismatch" classification).
 */
@Entity('receiving_wallets')
@Index(['gateway', 'coin', 'network'])
@Index(['address'])
export class ReceivingWallet {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** BINANCE | OKX | OXAPAY | BTCPAY */
  @Column({ type: 'varchar', length: 24 }) gateway: string;

  /** BTC | USDT | ETH | … */
  @Column({ type: 'varchar', length: 16 }) coin: string;

  /** BTC | TRC20 | ERC20 | BEP20 | Polygon | OFF_CHAIN … */
  @Column({ type: 'varchar', length: 32 }) network: string;

  /** On-chain address (or internal account id for off-chain) */
  @Column({ type: 'varchar', length: 255 }) address: string;

  /** Friendly label, e.g. "Binance Main BTC", "OKX Trading USDT-TRC20" */
  @Column({ type: 'varchar', length: 120, nullable: true }) label: string;

  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ default: true }) is_active: boolean;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
