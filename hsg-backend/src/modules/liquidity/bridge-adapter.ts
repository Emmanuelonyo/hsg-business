import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import { PayoutPartner, PayoutRequest, PayoutResult } from './payout-partner';

/**
 * BridgeAdapter: the production seam for the payout leg (PRD "Settlement partner: Bridge").
 *
 * STATUS: FUTURE WORK. No Bridge sandbox credentials exist for this build (PRD open question 1),
 * so `payout()` throws "Bridge sandbox not configured" unless BRIDGE_API_URL and BRIDGE_API_KEY are
 * set. The live demo routes every payout through SimulatedAdapter. What IS implemented is the exact
 * request the saga would send, so the integration can be reviewed and tested without network access:
 *
 *   POST {BRIDGE_API_URL}/v0/transfers
 *   Api-Key: {BRIDGE_API_KEY}
 *   Idempotency-Key: {transfer id}         <- a retried saga step can never create a second transfer
 *   {
 *     "on_behalf_of": "{bridge customer id}",
 *     "source":      { "payment_rail": "base", "currency": "usdc", "from_address": "0x..." },
 *     "destination": { "payment_rail": "wire", "currency": "usd",
 *                      "external_account_id": "...", "amount": "1000.00" }   <- fixed output
 *   }
 *
 * Setting destination.amount makes it a fixed-output transfer: Bridge works out the USDC needed and
 * the beneficiary receives exactly the quoted amount. In the full integration MATCH would create the
 * transfer, CHAIN_SEND would pay `source_deposit_instructions.to_address` from the response, and
 * PAYOUT would poll GET /v0/transfers/{id} (awaiting_funds -> payment_submitted -> payment_processed).
 */

/** Bridge payout rail per destination currency (PRD table). */
export const BRIDGE_RAILS: Record<string, string> = {
  USD: 'wire',
  EUR: 'sepa',
  GBP: 'faster_payments',
  MXN: 'spei',
  BRL: 'pix',
  COP: 'bre_b',
};

export interface BridgeTransferRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: {
    on_behalf_of: string;
    source: { payment_rail: 'base'; currency: 'usdc'; from_address: string };
    destination: { payment_rail: string; currency: string; external_account_id: string; amount: string };
  };
}

/** 123456n cents -> "1234.56" (Bridge takes decimal strings). */
export const centsToDecimal = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;

@Injectable()
export class BridgeAdapter implements PayoutPartner {
  readonly name = 'BRIDGE' as const;

  private get apiUrl() { return process.env.BRIDGE_API_URL ?? ''; }
  private get apiKey() { return process.env.BRIDGE_API_KEY ?? ''; }
  private get customerId() { return process.env.BRIDGE_CUSTOMER_ID ?? 'cust_unconfigured'; }

  isConfigured(): boolean { return Boolean(this.apiUrl && this.apiKey); }

  /** Builds the POST /v0/transfers request described in the PRD. Pure: no network. */
  buildTransferRequest(req: PayoutRequest): BridgeTransferRequest {
    const currency = (req.currency ?? 'USD').toUpperCase();
    return {
      method: 'POST',
      url: `${this.apiUrl.replace(/\/$/, '')}/v0/transfers`,
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': this.apiKey,
        // The gateway's transfer id: Bridge de-duplicates on it, matching our own saga idempotency.
        'Idempotency-Key': req.transferId,
      },
      body: {
        on_behalf_of: this.customerId,
        source: { payment_rail: 'base', currency: 'usdc', from_address: req.fromAddress ?? '' },
        destination: {
          payment_rail: req.paymentRail ?? BRIDGE_RAILS[currency] ?? 'wire',
          currency: currency.toLowerCase(),
          // In production each beneficiary is registered as a Bridge external account first.
          external_account_id: req.externalAccountId ?? '',
          amount: centsToDecimal(req.usdCents),
        },
      },
    };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!this.isConfigured()) {
      // Hard (non-transient): retrying will not make credentials appear.
      throw new DomainError('BRIDGE_NOT_CONFIGURED', 'Bridge sandbox not configured', false);
    }
    // Untested against a live sandbox (future work). Shape follows the Bridge docs cited in the PRD.
    const r = this.buildTransferRequest(req);
    let res: Response;
    try {
      res = await fetch(r.url, { method: r.method, headers: r.headers, body: JSON.stringify(r.body) });
    } catch (e: any) {
      return { ok: false, hard: false, reason: `Bridge unreachable: ${e?.message ?? e}` };
    }
    const json: any = await res.json().catch(() => ({}));
    if (res.ok && json?.id) return { ok: true, externalRef: String(json.id) };
    // 5xx / 429 are worth retrying; other 4xx are a rejected request.
    const transient = res.status >= 500 || res.status === 429;
    return { ok: false, hard: !transient, reason: `Bridge ${res.status}: ${json?.message ?? 'transfer rejected'}` };
  }
}
