import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type WalletCode = 'OXAPAY' | 'BTCPAY' | 'BINANCE' | 'OKX' | 'WIO_BANK' | 'MANUAL';
export type LedgerTxType =
  | 'deposit'        // crypto/fiat coming into a wallet from a customer / external party
  | 'batch_out'      // outgoing transfer (negative)
  | 'batch_in'       // incoming transfer (positive) — pair of batch_out on another wallet
  | 'convert_from'   // coin sold (negative)
  | 'convert_to'     // coin bought (positive)
  | 'cashout'        // wallet → bank (negative)
  | 'bank_deposit'   // bank received (positive on WIO_BANK)
  | 'expense'        // outgoing payment to vendor (negative)
  | 'fee'            // network/bank/exchange fee (negative)
  | 'adjustment';    // manual correction

@Entity('wallet_ledgers')
@Index(['wallet', 'coin', 'event_at'])
@Index(['linked_recharge_id'])
@Index(['linked_batch_id'])
@Index(['tx_hash'])
export class WalletLedger {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'varchar', length: 20 }) wallet: WalletCode;
  @Column({ type: 'varchar', length: 12 }) coin: string;
  @Column({ type: 'varchar', length: 24, nullable: true }) network: string;

  @Column({ type: 'decimal', precision: 30, scale: 10 }) amount: string; // SIGNED: +deposit, -outflow
  @Column({ type: 'varchar', length: 20 }) tx_type: LedgerTxType;

  // Cross-references (any subset may be filled)
  @Column({ nullable: true }) linked_recharge_id: string;
  @Column({ nullable: true }) linked_batch_id: string;
  @Column({ nullable: true }) linked_expense_id: string;
  @Column({ nullable: true }) linked_invoice_id: string;
  @Column({ nullable: true }) linked_ledger_id: string; // mate entry of a batch / conversion pair

  @Column({ nullable: true }) tx_hash: string;
  @Column({ nullable: true }) external_ref: string;   // batch code, OxaPay track id, etc.
  @Column({ nullable: true }) counterparty: string;   // customer code, vendor name, wallet address

  // FX info captured at event time
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true }) rate_used: string;
  @Column({ type: 'decimal', precision: 30, scale: 10, nullable: true }) fee_amount: string;
  @Column({ type: 'varchar', length: 12, nullable: true }) fee_currency: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) aed_value_at_event: string;

  @Column({ type: 'text', nullable: true }) notes: string;
  @Column({ nullable: true }) actor_email: string;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  event_at: Date;

  @CreateDateColumn() created_at: Date;
}
