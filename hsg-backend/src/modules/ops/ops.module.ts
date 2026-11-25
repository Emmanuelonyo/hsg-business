import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { SettlementModule } from '../settlement/settlement.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({ imports: [LedgerModule, SettlementModule], controllers: [OpsController], providers: [OpsService] })
export class OpsModule {}
