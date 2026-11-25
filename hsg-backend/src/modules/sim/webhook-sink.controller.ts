import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Public, Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { newId } from '../../common/ids';

/** A local "request bin": SME webhooks can point here so the operator console shows what was delivered. */
@Controller('sim')
export class WebhookSinkController {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /api/sim/webhook-sink (public) — logs the received body as a SINK webhook_event. */
  @Public()
  @Post('webhook-sink')
  @HttpCode(200)
  async sink(@Body() body: any, @Headers('x-hsg-signature') signature: string | undefined) {
    const payload = body && typeof body === 'object' ? body : { raw: body ?? null };
    const ev = await this.prisma.webhookEvent.create({
      data: {
        id: newId('wh'),
        smeId: null,
        direction: 'SINK',
        event: typeof payload.event === 'string' ? payload.event.slice(0, 100) : 'unknown',
        url: null,
        payload,
        signature: signature ?? null,
        status: 200,
      },
    });
    return { ok: true, id: ev.id };
  }

  /** GET /api/sim/webhook-events (operator) — last 50, both OUTBOUND and SINK. */
  @Roles('OPERATOR')
  @Get('webhook-events')
  async events() {
    const rows = await this.prisma.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      items: rows.map((r) => ({
        id: r.id, sme_id: r.smeId, direction: r.direction, event: r.event, url: r.url,
        payload: r.payload, signature: r.signature, status: r.status, created_at: r.createdAt.toISOString(),
      })),
    };
  }
}
