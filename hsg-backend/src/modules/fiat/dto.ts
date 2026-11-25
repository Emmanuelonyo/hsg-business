import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString() @IsNotEmpty() email: string;

  @IsString() @IsNotEmpty() password: string;
}

export class CreateBeneficiaryDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;

  /** ISO-3166 alpha-2, e.g. "CN" */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString() @Length(2, 2) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' }) country: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) bank_name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value))
  @IsString() @Matches(/^[A-Z0-9]{4,34}$/, { message: 'account_number must be 4-34 letters or digits' }) account_number: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString() @Matches(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, { message: 'swift_bic must be 8 or 11 characters' }) swift_bic?: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) address: string;

  @IsOptional() @IsIn(['USD']) currency?: 'USD';
}

export class CreateQuoteDto {
  /** USD cents as a string, e.g. "100000" = USD 1,000.00 */
  @IsString() @Matches(/^[1-9][0-9]{0,11}$/, { message: 'usd_amount must be a positive whole number of cents' }) usd_amount: string;
}

export class CreateTransferDto {
  @IsString() @IsNotEmpty() quote_id: string;
  @IsString() @IsNotEmpty() beneficiary_id: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(280) purpose: string;
}

export class ListTransfersQuery {
  @IsOptional() @IsIn(['Processing', 'Under review', 'Completed', 'Reversed', 'Declined']) status?: 'Processing' | 'Under review' | 'Completed' | 'Reversed' | 'Declined';

  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt() @Min(1) @Max(200) limit?: number;
}
