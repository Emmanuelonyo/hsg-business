import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'QUOTE_EXPIRED' | 'INSUFFICIENT_FUNDS' | 'BENEFICIARY_NOT_CLEARED' | 'KYB_NOT_VERIFIED'
  | 'IDEMPOTENCY_CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'CONFLICT' | 'RATE_LIMITED';

const STATUS: Record<ErrorCode, number> = {
  QUOTE_EXPIRED: 409, INSUFFICIENT_FUNDS: 422, BENEFICIARY_NOT_CLEARED: 422, KYB_NOT_VERIFIED: 403,
  IDEMPOTENCY_CONFLICT: 409, NOT_FOUND: 404, FORBIDDEN: 403, UNAUTHORIZED: 401, VALIDATION_ERROR: 400, CONFLICT: 409, RATE_LIMITED: 429,
};

/** Throw this everywhere. The global filter renders {"error":{"code","message"}}. */
export class ApiError extends HttpException {
  constructor(public readonly code: ErrorCode, message: string, status?: number) {
    super({ error: { code, message } }, status ?? STATUS[code] ?? HttpStatus.BAD_REQUEST);
  }
}

/** Domain error thrown inside services/saga (not HTTP). `transient` = retry; otherwise hard failure -> compensation. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly transient = false) { super(message); }
}
