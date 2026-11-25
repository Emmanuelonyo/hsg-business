import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Self-service onboarding. Creates the business with KYB PENDING; it cannot send until an operator verifies it. */
export class RegisterDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(160)
  legal_name: string;

  /** CAC registration number, e.g. RC1234567 or BN1234567. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : value))
  @Matches(/^(RC|BN|IT)?\d{5,8}$/, { message: 'Enter the CAC number, e.g. RC1234567' })
  rc_number: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(300)
  address: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(120)
  contact_name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid work email' }) @MaxLength(200)
  email: string;

  @IsString() @MinLength(8, { message: 'Use at least 8 characters' }) @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Use at least one letter and one number' })
  password: string;
}
