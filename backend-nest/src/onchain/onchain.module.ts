import { Module } from '@nestjs/common';
import { OnchainController } from './onchain.controller';
@Module({ controllers: [OnchainController] })
export class OnchainModule {}
