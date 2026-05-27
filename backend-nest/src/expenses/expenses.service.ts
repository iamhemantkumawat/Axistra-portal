import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '../entities/expense.entity';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletCode } from '../entities/wallet-ledger.entity';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense) private repo: Repository<Expense>,
    private audit: AuditService,
    private wallets: WalletsService,
  ) {}

  private async nextExpenseCode() {
    const now = new Date();
    const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.repo
      .createQueryBuilder('e')
      .where('e.expense_code LIKE :prefix', { prefix: `EXP-${stamp}-%` })
      .getCount();
    return `EXP-${stamp}-${String(count + 1).padStart(5, '0')}`;
  }

  list(query?: { category?: string; search?: string }) {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.expense_date', 'DESC');
    if (query?.category) qb.andWhere('e.category = :c', { c: query.category });
    if (query?.search) {
      const s = `%${query.search}%`;
      qb.andWhere('(e.vendor_name ILIKE :s OR e.notes ILIKE :s OR e.tx_hash ILIKE :s)', { s });
    }
    return qb.getMany();
  }

  /**
   * Determine which ledger wallet a given expense should debit, based on
   * payment_method, vendor_wallet and crypto fields.
   */
  private pickWallet(data: Partial<Expense>): { wallet: WalletCode; coin: string } | null {
    const method = String(data.payment_method || '').toLowerCase();
    const wallet = String(data.vendor_wallet || '').toLowerCase();
    const network = String(data.crypto_network || '').toLowerCase();
    const currency = String(data.currency || '').toUpperCase();

    if (method.includes('bank')) return { wallet: 'WIO_BANK', coin: currency || 'AED' };
    if (method.includes('binance') || wallet.includes('binance')) return { wallet: 'BINANCE', coin: 'USDT' };
    if (method.includes('okx') || wallet.includes('okx')) return { wallet: 'OKX', coin: 'USDT' };
    if (method.includes('oxapay') || wallet.includes('oxapay')) return { wallet: 'OXAPAY', coin: 'USDT' };
    if (method === 'usdt' || data.paid_in_usdt) {
      // Default to OKX for USDT payments if not specified
      return { wallet: 'OKX', coin: 'USDT' };
    }
    if (method === 'card') return { wallet: 'MANUAL', coin: currency || 'AED' };
    if (method === 'cash') return { wallet: 'MANUAL', coin: currency || 'AED' };
    if (network) {
      // crypto network given without explicit wallet => assume manual
      return { wallet: 'MANUAL', coin: currency || 'USDT' };
    }
    return null;
  }

  async create(data: any, actor?: any) {
    if (data.paid_in_usdt && data.amount && data.aed_rate) {
      data.aed_value = (parseFloat(data.amount) * parseFloat(data.aed_rate)).toFixed(2);
    }
    const e = this.repo.create({
      ...data,
      expense_code: data.expense_code || await this.nextExpenseCode(),
      expense_date: data.expense_date || new Date(),
    });
    const saved = (await this.repo.save(e)) as unknown as Expense;
    await this.recordLedger(saved, actor);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_expense', entity_type: 'expense', entity_id: saved.id,
      details: `Created expense ${data.vendor_name} ${data.amount} ${data.currency}`,
    });
    return saved;
  }

  async update(id: string, data: any, actor?: any) {
    const e = await this.repo.findOne({ where: { id } });
    if (!e) throw new NotFoundException();
    Object.assign(e, data);
    const saved = await this.repo.save(e);
    // Re-record ledger: remove previous linked entries and add fresh ones
    await this.wallets.removeExpenseLedger(saved.id);
    await this.recordLedger(saved, actor);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_expense', entity_type: 'expense', entity_id: id,
    });
    return saved;
  }

  async delete(id: string, actor?: any) {
    await this.wallets.removeExpenseLedger(id);
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_expense', entity_type: 'expense', entity_id: id,
    });
    return { success: true };
  }

  private async recordLedger(expense: Expense, actor?: any) {
    const choice = this.pickWallet(expense);
    if (!choice) return;
    const amount = parseFloat(expense.amount || '0');
    if (!(amount > 0)) return;
    await this.wallets.recordExpense({
      wallet: choice.wallet,
      coin: choice.coin,
      amount: amount.toString(),
      expense_id: expense.id,
      vendor: expense.vendor_name,
      tx_hash: expense.tx_hash,
      notes: `${expense.expense_code || ''} ${expense.category || ''} ${expense.notes || ''}`.trim(),
    }, actor);
  }
}
