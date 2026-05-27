import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '../entities/expense.entity';
import { Vendor } from '../entities/vendor.entity';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletCode } from '../entities/wallet-ledger.entity';

const VALID_WALLETS: WalletCode[] = ['OXAPAY', 'BTCPAY', 'BINANCE', 'OKX', 'WIO_BANK'];

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense) private repo: Repository<Expense>,
    @InjectRepository(Vendor) private vendorRepo: Repository<Vendor>,
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
      qb.andWhere('(e.vendor_name ILIKE :s OR e.notes ILIKE :s OR e.tx_hash ILIKE :s OR e.bank_reference ILIKE :s)', { s });
    }
    return qb.getMany();
  }

  /**
   * Choose which wallet ledger should be debited by this expense.
   * Rules (in priority order):
   *  1. Explicit `source_wallet` from form
   *  2. Method = Bank/Card with bank_name → WIO_BANK (AED)
   *  3. Method = USDT/BinancePay with vendor_wallet hint → infer Binance/OKX/etc.
   *  4. Fallback heuristic on payment_method
   */
  private pickWallet(data: Partial<Expense>): { wallet: WalletCode; coin: string } | null {
    const explicit = String(data.source_wallet || '').toUpperCase() as WalletCode;
    if (VALID_WALLETS.includes(explicit)) {
      const coin = ['BINANCE', 'OKX', 'OXAPAY', 'BTCPAY'].includes(explicit)
        ? (data.currency?.toUpperCase() === 'USDT' || data.paid_in_usdt ? 'USDT' : (data.currency || 'USDT').toUpperCase())
        : (data.currency || 'AED').toUpperCase();
      return { wallet: explicit, coin };
    }

    const method = String(data.payment_method || '').toLowerCase();
    const currency = String(data.currency || '').toUpperCase();

    if (method === 'bank' || method === 'card') return { wallet: 'WIO_BANK', coin: currency || 'AED' };
    if (method === 'cash') return { wallet: 'WIO_BANK', coin: currency || 'AED' };
    if (method === 'usdt' || method === 'binancepay' || method === 'binance_pay' || method === 'binance pay') {
      return { wallet: 'BINANCE', coin: 'USDT' };
    }
    return null;
  }

  private async hydrateVendor(data: any) {
    if (data.vendor_id) {
      const vendor = await this.vendorRepo.findOne({ where: { id: data.vendor_id } });
      if (!vendor) throw new BadRequestException('Vendor not found');
      data.vendor_name = vendor.name;
      if (!data.source_wallet && vendor.default_wallet) data.source_wallet = vendor.default_wallet;
      if (!data.payment_method && vendor.default_payment_method) data.payment_method = vendor.default_payment_method;
    }
    if (!data.vendor_name?.trim()) throw new BadRequestException('Vendor is required');
  }

  async create(data: any, actor?: any) {
    await this.hydrateVendor(data);

    if (data.paid_in_usdt && data.amount && data.aed_rate) {
      data.aed_value = (parseFloat(data.amount) * parseFloat(data.aed_rate)).toFixed(2);
    }
    const payload: any = {
      expense_code: data.expense_code || await this.nextExpenseCode(),
      expense_date: data.expense_date || new Date(),
      vendor_id: data.vendor_id || null,
      vendor_name: data.vendor_name,
      category: data.category || 'Other',
      amount: data.amount,
      currency: (data.currency || 'AED').toUpperCase(),
      payment_method: data.payment_method || 'Bank',
      bank_name: data.bank_name || null,
      source_wallet: data.source_wallet ? String(data.source_wallet).toUpperCase() : null,
      paid_in_usdt: !!data.paid_in_usdt,
      vendor_wallet: data.vendor_wallet || null,
      crypto_network: data.crypto_network || null,
      tx_hash: data.tx_hash || null,
      aed_rate: data.aed_rate || null,
      aed_value: data.aed_value || null,
      bank_reference: data.bank_reference || null,
      receipt_url: data.receipt_url || null,
      notes: data.notes || null,
    };
    const saved = (await this.repo.save(this.repo.create(payload))) as unknown as Expense;
    await this.recordLedger(saved, actor);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_expense', entity_type: 'expense', entity_id: saved.id,
      details: `Created expense ${saved.vendor_name} ${saved.amount} ${saved.currency} via ${saved.payment_method}`,
    });
    return saved;
  }

  async update(id: string, data: any, actor?: any) {
    const e = await this.repo.findOne({ where: { id } });
    if (!e) throw new NotFoundException();
    await this.hydrateVendor({ ...e, ...data });
    Object.assign(e, data);
    if (e.source_wallet) e.source_wallet = String(e.source_wallet).toUpperCase();
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
    const ref = expense.tx_hash || expense.bank_reference || undefined;
    await this.wallets.recordExpense({
      wallet: choice.wallet,
      coin: choice.coin,
      amount: amount.toString(),
      expense_id: expense.id,
      vendor: expense.vendor_name,
      tx_hash: ref,
      notes: `${expense.expense_code || ''} ${expense.category || ''} via ${expense.payment_method}${expense.bank_name ? ` (${expense.bank_name})` : ''}${expense.notes ? ' — ' + expense.notes : ''}`.trim(),
    }, actor);
  }
}
