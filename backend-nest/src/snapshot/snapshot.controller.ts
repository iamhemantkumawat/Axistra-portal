import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletLedger } from '../entities/wallet-ledger.entity';

@UseGuards(AuthGuard('jwt'))
@Controller('snapshot')
export class SnapshotController {
  constructor(@InjectRepository(WalletLedger) private ledger: Repository<WalletLedger>) {}

  // Daily end-of-day close per wallet/coin:
  // opening_balance + ins - outs + adjustments = closing_balance
  @Get('daily')
  async daily(@Query('date') date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
    const end = new Date(start.getTime() + 24 * 3600 * 1000);

    // Opening balance per wallet+coin = sum of all amounts BEFORE start
    const opening = await this.ledger.createQueryBuilder('l')
      .select('l.wallet', 'wallet').addSelect('l.coin', 'coin')
      .addSelect('SUM(l.amount::numeric)', 'balance')
      .where('l.event_at < :start', { start })
      .groupBy('l.wallet').addGroupBy('l.coin').getRawMany();

    // Day activity grouped by wallet+coin+tx_type
    const activity = await this.ledger.createQueryBuilder('l')
      .select('l.wallet', 'wallet').addSelect('l.coin', 'coin').addSelect('l.tx_type', 'tx_type')
      .addSelect('SUM(l.amount::numeric)', 'amount').addSelect('COUNT(*)', 'count')
      .where('l.event_at >= :start AND l.event_at < :end', { start, end })
      .groupBy('l.wallet').addGroupBy('l.coin').addGroupBy('l.tx_type').getRawMany();

    // Closing = opening + sum(activity)
    const map: Record<string, any> = {};
    opening.forEach((r) => {
      const k = `${r.wallet}|${r.coin}`;
      map[k] = { wallet: r.wallet, coin: r.coin, opening: parseFloat(r.balance), ins: 0, outs: 0, activity: [], closing: parseFloat(r.balance) };
    });
    activity.forEach((r) => {
      const k = `${r.wallet}|${r.coin}`;
      if (!map[k]) map[k] = { wallet: r.wallet, coin: r.coin, opening: 0, ins: 0, outs: 0, activity: [], closing: 0 };
      const amt = parseFloat(r.amount);
      map[k].activity.push({ tx_type: r.tx_type, amount: amt, count: parseInt(r.count, 10) });
      if (amt >= 0) map[k].ins += amt;
      else map[k].outs += amt;
      map[k].closing += amt;
    });
    Object.values(map).forEach((m: any) => { m.closing = m.opening + m.ins + m.outs; });
    return { date: start.toISOString().slice(0, 10), rows: Object.values(map) };
  }
}
