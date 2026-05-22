import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { Customer } from '../entities/customer.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser, Customer])],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
