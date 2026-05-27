import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  providers: [FxService],
  controllers: [FxController],
  exports: [FxService],
})
export class FxModule {}
