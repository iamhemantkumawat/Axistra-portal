import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '../entities/admin-user.entity';
import { AuditService } from '../audit/audit.service';
import { TwoFaService } from './two-fa.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>,
    private jwt: JwtService,
    private audit: AuditService,
    private twoFa: TwoFaService,
  ) {}

  private enforceAdmin2fa(): boolean {
    return String(process.env.ENFORCE_ADMIN_2FA || '').toLowerCase() === 'true';
  }

  async login(email: string, password: string, ip?: string) {
    const user = await this.adminRepo.findOne({ where: { email } });
    if (!user || !user.is_active) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // If 2FA is enabled for this user, do NOT issue the full access token yet.
    // Return a short-lived challenge token instead and require step 2.
    if (user.two_fa_enabled) {
      const challenge_token = await this.jwt.signAsync(
        { sub: user.id, email: user.email, purpose: '2fa_challenge' },
        { expiresIn: '10m' },
      );
      return {
        require_2fa: true,
        challenge_token,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      };
    }

    // 2FA not enabled. If admin role and enforcement is on, force setup.
    const must_setup_2fa = this.enforceAdmin2fa() && user.role === 'admin' && !user.two_fa_enabled;

    return this.issueFullToken(user, ip, { must_setup_2fa });
  }

  async verify2faAndLogin(challengeToken: string, code: string | null, recoveryCode: string | null, ip?: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(challengeToken);
    } catch {
      throw new UnauthorizedException('Challenge expired — sign in again');
    }
    if (payload?.purpose !== '2fa_challenge') throw new UnauthorizedException('Invalid challenge token');

    const user = await this.adminRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.is_active) throw new UnauthorizedException('Account unavailable');
    if (!user.two_fa_enabled) throw new BadRequestException('2FA is not enabled on this account');

    let verified = false;
    if (code) verified = this.twoFa.verifyTotp(user, code);
    if (!verified && recoveryCode) {
      verified = await this.twoFa.consumeRecoveryCode(user, recoveryCode);
    }
    if (!verified) throw new UnauthorizedException('Invalid 2FA or recovery code');

    return this.issueFullToken(user, ip, { must_setup_2fa: false });
  }

  private async issueFullToken(user: AdminUser, ip?: string, extras?: { must_setup_2fa?: boolean }) {
    user.last_login_at = new Date();
    user.last_login_ip = ip || null;
    await this.adminRepo.save(user);
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, two_fa: user.two_fa_enabled },
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' },
    );
    await this.audit.log({
      actor_id: user.id,
      actor_email: user.email,
      action: 'login',
      entity_type: 'admin_user',
      entity_id: user.id,
      ip_address: ip,
    });
    return {
      token,
      user: {
        id: user.id, email: user.email, full_name: user.full_name,
        role: user.role, two_fa_enabled: user.two_fa_enabled,
        must_setup_2fa: !!extras?.must_setup_2fa,
      },
    };
  }

  async me(userId: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const must_setup_2fa = this.enforceAdmin2fa() && user.role === 'admin' && !user.two_fa_enabled;
    return {
      id: user.id, email: user.email, full_name: user.full_name,
      role: user.role, two_fa_enabled: user.two_fa_enabled,
      last_login_at: user.last_login_at,
      must_setup_2fa,
      enforce_admin_2fa: this.enforceAdmin2fa(),
    };
  }

  async listAdmins() {
    const list = await this.adminRepo.find({ order: { created_at: 'DESC' } });
    return list.map((u) => ({
      id: u.id, email: u.email, full_name: u.full_name, role: u.role,
      is_active: u.is_active, last_login_at: u.last_login_at,
      two_fa_enabled: u.two_fa_enabled, created_at: u.created_at,
    }));
  }

  async createAdmin(data: { email: string; password: string; full_name?: string; role?: string }) {
    const exists = await this.adminRepo.findOne({ where: { email: data.email } });
    if (exists) throw new UnauthorizedException('Email already exists');
    const hash = await bcrypt.hash(data.password, 10);
    const user = this.adminRepo.create({
      email: data.email,
      password_hash: hash,
      full_name: data.full_name || data.email.split('@')[0],
      role: data.role || 'admin',
    });
    return this.adminRepo.save(user);
  }
}
