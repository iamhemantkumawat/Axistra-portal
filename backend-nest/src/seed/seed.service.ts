import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '../entities/admin-user.entity';

@Injectable()
export class SeedService {
  private logger = new Logger('Seed');

  constructor(@InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>) {}

  async run() {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@axistratech.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    const existing = await this.adminRepo.findOne({ where: { email } });
    if (existing) {
      // Always ensure password is valid for seeded admin (idempotent)
      const ok = await bcrypt.compare(password, existing.password_hash);
      if (!ok) {
        existing.password_hash = await bcrypt.hash(password, 10);
        await this.adminRepo.save(existing);
        this.logger.log(`Reset password for seeded admin ${email}`);
      } else {
        this.logger.log(`Seed admin already present: ${email}`);
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
}
