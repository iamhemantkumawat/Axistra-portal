import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AdminUser } from '../entities/admin-user.entity';

// Allow ±30s (one step) clock drift on both sides — pragmatic for users
// scanning slightly later than they expect.
const EPOCH_TOLERANCE_SECONDS: number = 30;

@Injectable()
export class TwoFaService {
  constructor(@InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>) {}

  private issuer() {
    return process.env.TWO_FA_ISSUER || 'Axistra Portal';
  }

  /**
   * Initiate enrollment: generates a new secret (stored UNCONFIRMED until verify),
   * returns the otpauth URL + QR code data URL. Does NOT enable 2FA yet.
   */
  async setup(userId: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Admin not found');

    const issuer = this.issuer();
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer, label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Persist secret immediately. two_fa_enabled stays false until verify.
    user.two_fa_secret = secret;
    user.two_fa_enabled = false;
    user.two_fa_recovery_codes = null;
    await this.adminRepo.save(user);

    return {
      otpauth_url: otpauthUrl,
      qr_data_url: qrDataUrl,
      secret, // Shown once in the UI as the manual-entry fallback.
      issuer,
    };
  }

  /**
   * Verify a TOTP code with the user's pending secret and flip two_fa_enabled=true.
   * Generates and returns plain-text recovery codes ONCE.
   */
  async verifyAndEnable(userId: string, code: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Admin not found');
    if (!user.two_fa_secret) throw new BadRequestException('Call /auth/2fa/setup first');
    if (!this.checkToken(user.two_fa_secret, code)) {
      throw new UnauthorizedException('Invalid authenticator code');
    }
    const plainCodes = this.generateRecoveryCodes(10);
    user.two_fa_recovery_codes = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 10)));
    user.two_fa_enabled = true;
    await this.adminRepo.save(user);
    return { enabled: true, recovery_codes: plainCodes };
  }

  /**
   * Disable 2FA. Requires either current TOTP code or a recovery code.
   */
  async disable(userId: string, code?: string, recoveryCode?: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Admin not found');
    if (!user.two_fa_enabled) return { disabled: true };

    let allowed = false;
    if (code && user.two_fa_secret && this.checkToken(user.two_fa_secret, code)) {
      allowed = true;
    }
    if (!allowed && recoveryCode) {
      allowed = await this.consumeRecoveryCode(user, recoveryCode);
    }
    if (!allowed) throw new UnauthorizedException('Provide a valid 2FA or recovery code');

    user.two_fa_enabled = false;
    user.two_fa_secret = null;
    user.two_fa_recovery_codes = null;
    await this.adminRepo.save(user);
    return { disabled: true };
  }

  /** Verifies an authenticator code against the user's stored secret. */
  verifyTotp(user: AdminUser, code: string): boolean {
    if (!user.two_fa_enabled || !user.two_fa_secret) return false;
    return this.checkToken(user.two_fa_secret, code);
  }

  private checkToken(secret: string, code: string): boolean {
    const token = String(code || '').trim();
    if (!/^\d{6}$/.test(token)) return false;
    try {
      const res = verifySync({ secret, token, epochTolerance: EPOCH_TOLERANCE_SECONDS });
      return !!(res as { valid?: boolean })?.valid;
    } catch {
      return false;
    }
  }

  /**
   * Try to match `recoveryCode` against any stored bcrypt hash; if found,
   * remove that hash (single-use) and persist. Returns true on success.
   */
  async consumeRecoveryCode(user: AdminUser, recoveryCode: string): Promise<boolean> {
    if (!user.two_fa_recovery_codes?.length) return false;
    const normalized = String(recoveryCode || '').trim().toUpperCase();
    if (!normalized) return false;
    for (let i = 0; i < user.two_fa_recovery_codes.length; i++) {
      const hash = user.two_fa_recovery_codes[i];
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(normalized, hash)) {
        const updated = [...user.two_fa_recovery_codes];
        updated.splice(i, 1);
        user.two_fa_recovery_codes = updated;
        await this.adminRepo.save(user);
        return true;
      }
    }
    return false;
  }

  /** Re-generate recovery codes (invalidates prior ones). Requires 2FA enabled. */
  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.adminRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Admin not found');
    if (!user.two_fa_enabled || !user.two_fa_secret) {
      throw new BadRequestException('2FA is not enabled');
    }
    if (!this.checkToken(user.two_fa_secret, code)) {
      throw new UnauthorizedException('Invalid authenticator code');
    }
    const plainCodes = this.generateRecoveryCodes(10);
    user.two_fa_recovery_codes = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 10)));
    await this.adminRepo.save(user);
    return { recovery_codes: plainCodes };
  }

  private generateRecoveryCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // 10 chars of base32-ish randomness, formatted as XXXXX-XXXXX
      const raw = crypto.randomBytes(8).toString('base64').replace(/[+/=]/g, '').toUpperCase().slice(0, 10);
      codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
    }
    return codes;
  }
}
