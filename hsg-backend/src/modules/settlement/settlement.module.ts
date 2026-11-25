import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { ReconcileController } from './reconcile.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({ imports: [LedgerModule], controllers: [ReconcileController], providers: [SettlementService], exports: [SettlementService] })
export class SettlementModule {}
