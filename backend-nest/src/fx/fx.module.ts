import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { AppSetting } from '../entities/app-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  providers: [FxService],
  controllers: [FxController],
  exports: [FxService],
})
export class FxModule {}
