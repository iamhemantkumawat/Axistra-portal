import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { PayrollService } from './payroll.service';

/**
 * PUBLIC token-protected endpoints used by the employee back-signing flow.
 * No JWT — possession of the `sign_token` is the credential. Tokens are
 * 24 bytes of base64url randomness and can be rotated by an admin.
 *
 * Mounted under /api/sign-letter/* (the /sign/ frontend route resolves the
 * token client-side and calls these endpoints).
 */
@Controller('sign-letter')
export class SignLetterController {
  constructor(private svc: PayrollService) {}

  @Get(':token')
  getDocument(@Param('token') token: string) {
    return this.svc.getSignDocument(token);
  }

  @Post(':token')
  submitDecision(@Param('token') token: string, @Body() body: any, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.svc.submitSignDecision(
      token,
      body,
      Array.isArray(ip) ? ip[0] : ip,
      userAgent,
    );
  }
}
