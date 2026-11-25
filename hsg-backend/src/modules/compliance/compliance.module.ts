import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ReviewController } from './review.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({ imports: [LedgerModule], controllers: [ReviewController], providers: [ComplianceService], exports: [ComplianceService] })
export class ComplianceModule {}
