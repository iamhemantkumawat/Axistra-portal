import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OnchainService } from './onchain.service';

@UseGuards(AuthGuard('jwt'))
@Controller('onchain')
export class OnchainController {
  constructor(private svc: OnchainService) {}

  @Get('verify/:network/:hash')
  async verify(@Param('network') network: string, @Param('hash') hash: string) {
    if (!hash) throw new BadRequestException('Missing hash');
    return this.svc.verify(network, hash);
  }
}
