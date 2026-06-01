import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf, IsIn } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

/**
 * Validation for `POST /api/customers`. Previously the endpoint accepted
 * `{}` and silently created an "Unknown customer" — flagged by the
 * iter24 testing agent as a pre-existing data-quality bug.
 *
 * Hardening rule: the request body MUST carry at least one human-readable
 * identifier so the customer row is searchable downstream. Any of
 * `full_name`, `first_name`, `last_name`, `company_name`, `magnus_username`,
 * `email`, or `phone` is sufficient — matching exactly what the service's
 * `create()` already derives from.
 */
export class CreateCustomerDto {
  @IsOptional() @IsString() @MaxLength(120) full_name?: string;
  @IsOptional() @IsString() @MaxLength(80) first_name?: string;
  @IsOptional() @IsString() @MaxLength(80) last_name?: string;
  @IsOptional() @IsString() @MaxLength(120) company_name?: string;

  @IsOptional() @IsString() @MaxLength(80) magnus_username?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) telegram?: string;

  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(80) id_number?: string;
  @IsOptional() @IsString() @MaxLength(80) signup_ip?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional() @IsIn(['pending', 'active', 'suspended', 'blocked']) status?: string;
  @IsOptional() @IsIn(['Low', 'Medium', 'High']) risk_level?: string;
  @IsOptional() @IsIn(['not_required', 'requested', 'submitted', 'approved', 'rejected']) kyc_status?: string;

  /**
   * Class-level guard — at least one identifier must be present and non-blank.
   * Validation pipes don't natively support multi-field "any-of" requirements
   * cleanly, so we run the check inside the service after binding.
   */
  static ensureHasIdentifier(payload: CreateCustomerDto) {
    const identifiers = [
      payload.full_name, payload.first_name, payload.last_name,
      payload.company_name, payload.magnus_username, payload.email, payload.phone,
    ].map((v) => (typeof v === 'string' ? v.trim() : ''));
    if (!identifiers.some(Boolean)) {
      throw new BadRequestException(
        'At least one of full_name, first_name, last_name, company_name, magnus_username, email or phone is required',
      );
    }
  }
}
