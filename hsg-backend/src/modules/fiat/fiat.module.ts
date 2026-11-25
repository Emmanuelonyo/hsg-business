import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { MeController } from './me.controller';
import { BeneficiariesController } from './beneficiaries.controller';
import { QuotesController } from './quotes.controller';
import { TransfersController } from './transfers.controller';
import { FiatService } from './fiat.service';
import { TransferReferenceService } from './transfer-reference';

@Module({
  imports: [LedgerModule, ComplianceModule, LiquidityModule],
  controllers: [MeController, BeneficiariesController, QuotesController, TransfersController],
  providers: [FiatService, TransferReferenceService],
})
export class FiatModule {}
