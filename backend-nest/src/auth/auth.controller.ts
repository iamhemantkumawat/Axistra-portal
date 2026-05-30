import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { TwoFaService } from './two-fa.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private twoFa: TwoFaService) {}

  private clientIp(req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress;
    return Array.isArray(ip) ? ip[0] : ip;
  }

  @HttpCode(200)
  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Req() req: any) {
    return this.auth.login(body.email, body.password, this.clientIp(req));
  }

  @HttpCode(200)
  @Post('2fa/login-verify')
  async loginVerify2fa(
    @Body() body: { challenge_token: string; code?: string; recovery_code?: string },
    @Req() req: any,
  ) {
    return this.auth.verify2faAndLogin(body.challenge_token, body.code || null, body.recovery_code || null, this.clientIp(req));
  }

  @Post('logout')
  async logout() {
    return { success: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Req() req: any) {
    return this.auth.me(req.user.id);
  }

  // ---------- 2FA Management (JWT-authed, self-service) ----------

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/setup')
  async setup2fa(@Req() req: any) {
    return this.twoFa.setup(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/enable')
  async enable2fa(@Req() req: any, @Body() body: { code: string }) {
    return this.twoFa.verifyAndEnable(req.user.id, body.code);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/disable')
  async disable2fa(@Req() req: any, @Body() body: { code?: string; recovery_code?: string }) {
    return this.twoFa.disable(req.user.id, body.code, body.recovery_code);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/recovery-codes/regenerate')
  async regenRecovery(@Req() req: any, @Body() body: { code: string }) {
    return this.twoFa.regenerateRecoveryCodes(req.user.id, body.code);
  }

  // ---------- Admin user management ----------

  @UseGuards(AuthGuard('jwt'))
  @Get('admins')
  async listAdmins() {
    return this.auth.listAdmins();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admins')
  async createAdmin(@Body() body: any) {
    const created = await this.auth.createAdmin(body);
    return { id: created.id, email: created.email, full_name: created.full_name, role: created.role };
  }
}
