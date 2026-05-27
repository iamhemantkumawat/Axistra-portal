import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '../entities/expense.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense) private repo: Repository<Expense>,
    private audit: AuditService,
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

  async create(data: any, actor?: any) {
    if (data.paid_in_usdt && data.amount && data.aed_rate) {
      data.aed_value = (parseFloat(data.amount) * parseFloat(data.aed_rate)).toFixed(2);
    }
    const e = this.repo.create({
      ...data,
      expense_code: data.expense_code || await this.nextExpenseCode(),
      expense_date: data.expense_date || new Date(),
    });
    const saved = await this.repo.save(e);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_expense', entity_type: 'expense', entity_id: (saved as any).id,
      details: `Created expense ${data.vendor_name} ${data.amount} ${data.currency}`,
    });
    return saved;
  }

  async update(id: string, data: any, actor?: any) {
    const e = await this.repo.findOne({ where: { id } });
    if (!e) throw new NotFoundException();
    Object.assign(e, data);
    const saved = await this.repo.save(e);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_expense', entity_type: 'expense', entity_id: id,
    });
    return saved;
  }

  async delete(id: string, actor?: any) {
    await this.repo.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_expense', entity_type: 'expense', entity_id: id,
    });
    return { success: true };
  }
}
