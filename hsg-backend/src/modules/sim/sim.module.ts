import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { NipSimController } from './nip.controller';
import { WebhookSinkController } from './webhook-sink.controller';
import { ProvidersSimController } from './providers.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [NipSimController, WebhookSinkController, ProvidersSimController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class SimModule {}
