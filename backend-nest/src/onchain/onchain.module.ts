import { Module, Global } from '@nestjs/common';
import { OnchainController } from './onchain.controller';
import { OnchainService } from './onchain.service';

@Global()
@Module({
  providers: [OnchainService],
  controllers: [OnchainController],
  exports: [OnchainService],
})
export class OnchainModule {}
