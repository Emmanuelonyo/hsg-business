import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { LiquidityModule } from './modules/liquidity/liquidity.module';
import { SimModule } from './modules/sim/sim.module';
import { FiatModule } from './modules/fiat/fiat.module';
import { SagaModule } from './modules/saga/saga.module';
import { OpsModule } from './modules/ops/ops.module';

/** API process. Do not edit per-feature; each agent edits its own *.module.ts. */
@Module({
  imports: [CommonModule, AuthModule, LedgerModule, ComplianceModule, SettlementModule, LiquidityModule, SimModule, FiatModule, SagaModule, OpsModule],
})
export class AppModule {}
