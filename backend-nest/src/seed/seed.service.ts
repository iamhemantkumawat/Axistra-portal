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
    await this.seedReceivingWallets();
  }

  private async seedAdmin() {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@axistratech.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    const existing = await this.adminRepo.findOne({ where: { email } });
    if (existing) {
      const ok = await bcrypt.compare(password, existing.password_hash);
      if (!ok) {
        existing.password_hash = await bcrypt.hash(password, 10);
        await this.adminRepo.save(existing);
        this.logger.log(`Reset password for seeded admin ${email}`);
      }
      return;
    }
    const user = this.adminRepo.create({
      email,
      password_hash: await bcrypt.hash(password, 10),
      full_name: 'Axistra Admin',
      role: 'admin',
      is_active: true,
    });
    await this.adminRepo.save(user);
    this.logger.log(`Seeded admin user ${email}`);
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
