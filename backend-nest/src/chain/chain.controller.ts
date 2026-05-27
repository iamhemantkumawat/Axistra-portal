import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';
import { Recharge } from '../entities/recharge.entity';
import { Invoice } from '../entities/invoice.entity';
import { Customer } from '../entities/customer.entity';
import { Expense } from '../entities/expense.entity';

@UseGuards(AuthGuard('jwt'))
@Controller('chain')
export class ChainController {
  constructor(
    @InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>,
    @InjectRepository(Recharge) private recharges: Repository<Recharge>,
    @InjectRepository(Invoice) private invoices: Repository<Invoice>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Expense) private expenses: Repository<Expense>,
  ) {}

  /**
   * Universal search across the audit chain.
   * Accepts any of: tx_hash, batch_id (external_ref), invoice_number,
   * recharge_code, customer_code, bank_reference, ledger id, email.
   */
  @Get('search')
  async search(@Query('q') q: string) {
    if (!q || q.length < 3) return { query: q, matches: [], chain: null };
    const s = `%${q}%`;

    const ledgerRows = await this.ledger.createQueryBuilder('l')
      .where('l.tx_hash ILIKE :s OR l.external_ref ILIKE :s OR l.counterparty ILIKE :s', { s })
      .orderBy('l.event_at', 'DESC').take(50).getMany();

    const recharges = await this.recharges.createQueryBuilder('r')
      .leftJoinAndSelect('r.customer', 'c')
      .where('r.tx_hash ILIKE :s OR r.recharge_code ILIKE :s OR r.invoice_number ILIKE :s OR r.magnus_reference_id ILIKE :s OR r.magnus_username ILIKE :s', { s })
      .orderBy('r.created_at', 'DESC').take(20).getMany();

    const invoices = await this.invoices.createQueryBuilder('i')
      .where('i.invoice_number ILIKE :s OR i.tx_hash ILIKE :s', { s })
      .take(20).getMany();

    const customers = await this.customers.createQueryBuilder('c')
      .where('c.customer_code ILIKE :s OR c.full_name ILIKE :s OR c.email ILIKE :s OR c.magnus_username ILIKE :s', { s })
      .take(20).getMany();

    const expenses = await this.expenses.createQueryBuilder('e')
      .where('e.tx_hash ILIKE :s OR e.vendor_name ILIKE :s OR e.bank_reference ILIKE :s', { s }).take(20).getMany();

    // Build a chain view if there's exactly one strong hit on a recharge
    let chain: any = null;
    if (recharges.length === 1) {
      chain = await this.buildChainForRecharge(recharges[0]);
    } else if (ledgerRows.length && ledgerRows[0].linked_recharge_id) {
      const r = await this.recharges.findOne({ where: { id: ledgerRows[0].linked_recharge_id }, relations: ['customer'] });
      if (r) chain = await this.buildChainForRecharge(r);
    }

    return {
      query: q,
      counts: { ledger: ledgerRows.length, recharges: recharges.length, invoices: invoices.length, customers: customers.length, expenses: expenses.length },
      ledger: ledgerRows, recharges, invoices, customers, expenses,
      chain,
    };
  }

  private async buildChainForRecharge(r: any) {
    const all = await this.ledger.find({ where: [{ linked_recharge_id: r.id }] });
    const batchIds = Array.from(new Set(all.map((x) => x.linked_batch_id).filter(Boolean)));
    const externalRefs = Array.from(new Set(all.map((x) => x.external_ref).filter(Boolean)));
    const downstream = batchIds.length
      ? await this.ledger.createQueryBuilder('l').where('l.linked_batch_id IN (:...ids) OR l.external_ref IN (:...ids)', { ids: [...batchIds, ...externalRefs] }).orderBy('l.event_at', 'ASC').getMany()
      : all;
    const invoice = r.invoice_id ? await this.invoices.findOne({ where: { id: r.invoice_id } }) : null;
    return {
      customer: r.customer,
      recharge: r,
      invoice,
      ledger_entries: downstream,
    };
  }
}
