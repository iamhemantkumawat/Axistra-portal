import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '../entities/admin-user.entity';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';

@Injectable()
export class SeedService {
  private logger = new Logger('Seed');

  constructor(
    @InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>,
    @InjectRepository(ReceivingWallet) private walletRepo: Repository<ReceivingWallet>,
  ) {}

  async run() {
    await this.seedAdmin();
    await this.seedCharteredAccountant();
    await this.seedReceivingWallets();
  }

  private async seedAdmin() {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@axistratech.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    await this.seedOrRepairUser({ email, password, full_name: 'Axistra Admin', role: 'admin' });
  }

  /**
   * Idempotently seed the CA (chartered accountant) role account. Ensures the
   * documented credential (ca@axistratech.com / ca123456) works after every DB
   * restore, in addition to the primary admin.
   */
  private async seedCharteredAccountant() {
    await this.seedOrRepairUser({
      email: 'ca@axistratech.com',
      password: 'ca123456',
      full_name: 'Chartered Accountant',
      role: 'chartered_accountant',
    });
  }

  private async seedOrRepairUser(opts: { email: string; password: string; full_name: string; role: string }) {
    const { email, password, full_name, role } = opts;
    const existing = await this.adminRepo.findOne({ where: { email } });
    if (existing) {
      const ok = await bcrypt.compare(password, existing.password_hash);
      if (!ok) {
        existing.password_hash = await bcrypt.hash(password, 10);
        await this.adminRepo.save(existing);
        this.logger.log(`Reset password for seeded user ${email}`);
      }
      return;
    }
    const user = this.adminRepo.create({
      email,
      password_hash: await bcrypt.hash(password, 10),
      full_name,
      role,
      is_active: true,
    });
    await this.adminRepo.save(user);
    this.logger.log(`Seeded ${role} user ${email}`);
  }

  /**
   * Seed the initial Binance + OKX BTC receiving addresses (idempotent).
   * Admins can add USDT / ETH addresses later through the Settings UI.
   */
  private async seedReceivingWallets() {
    const defaults = [
      {
        gateway: 'Binance',
        coin: 'BTC',
        network: 'BTC',
        address: '129ifR1iQyY4fWkq3G8MXCMwReZZHhqfkt',
        label: 'Binance Main BTC',
      },
      {
        gateway: 'OKX',
        coin: 'BTC',
        network: 'BTC',
        address: 'bc1q3a4gskudn4kd3curm5yxjfnk2ey0zldv3v023wjyu29e0jwxg9ksx38sjj',
        label: 'OKX Main BTC',
      },
    ];

    for (const w of defaults) {
      const existing = await this.walletRepo.findOne({ where: { address: w.address } });
      if (existing) continue;
      await this.walletRepo.save(this.walletRepo.create({ ...w, is_active: true }));
      this.logger.log(`Seeded receiving wallet: ${w.gateway} ${w.coin}/${w.network}`);
    }
  }
}
