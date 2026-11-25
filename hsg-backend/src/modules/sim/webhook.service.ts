import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
import { newId } from '../../common/ids';
import { serializeTransfer } from '../fiat/sme-serializer';

export const WEBHOOK_SIGNATURE_HEADER = 'X-HSG-Signature';

/** hex HMAC-SHA256 of the exact body bytes sent. The SME verifies with its webhook secret. */
export function signWebhook(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** CONTRACT (owned by the Fiat+Compliance agent): outbound status webhook, HMAC-SHA256 signed (header X-HSG-Signature). Never throws. */
@Injectable()
export class WebhookService {
  private readonly log = new Logger(WebhookService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST {event, transfer} to the SME's webhook_url. The transfer is the SME-serialized shape
   * (same fiat boundary as the API). Records an OUTBOUND webhook_events row with the HTTP status
   * (null if the request failed). No webhook_url -> nothing to send.
   */
  async notifyTransfer(transferId: string, event: 'transfer.completed' | 'transfer.reversed'): Promise<void> {
    try {
      const t = await this.prisma.transfer.findUnique({ where: { id: transferId }, include: { beneficiary: true, sme: true } });
      if (!t || !t.sme.webhookUrl) return;

      const body = JSON.stringify({ event, transfer: serializeTransfer(t) });
      const signature = t.sme.webhookSecret ? signWebhook(body, t.sme.webhookSecret) : null;

      let status: number | null = null;
      try {
        const res = await fetch(t.sme.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(signature ? { [WEBHOOK_SIGNATURE_HEADER]: signature } : {}) },
          body,
          signal: AbortSignal.timeout(5000),
        });
        status = res.status;
      } catch (e) {
        this.log.warn(`webhook ${event} for ${transferId} failed: ${(e as Error).message}`);
      }

      await this.prisma.webhookEvent.create({
        data: { id: newId('wh'), smeId: t.smeId, direction: 'OUTBOUND', event, url: t.sme.webhookUrl, payload: JSON.parse(body), signature, status },
      });
    } catch (e) {
      // Never throw: a webhook problem must not fail the saga step that calls it.
      this.log.error(`notifyTransfer(${transferId}, ${event}) error: ${(e as Error).message}`);
    }
  }
}
