import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { Customer } from '../entities/customer.entity';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser, Customer, ReceivingWallet])],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
