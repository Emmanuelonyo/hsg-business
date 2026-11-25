import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SettlementModule } from '../settlement/settlement.module';
import { LiquidityModule } from '../liquidity/liquidity.module';
import { SimModule } from '../sim/sim.module';
import { SagaOpsController } from './saga-ops.controller';
import { SagaRunner } from './saga-runner';

/**
 * OWNER: Agent D. The worker entrypoint (src/worker.ts) boots WorkerModule which imports this module
 * and calls `start()` on the 'SagaRunner' provider. The API only uses SagaOpsController (retry) +
 * common SagaQueue; constructing SagaRunner there starts nothing.
 */
@Module({
  imports: [LedgerModule, ComplianceModule, SettlementModule, LiquidityModule, SimModule],
  controllers: [SagaOpsController],
  providers: [SagaRunner, { provide: 'SagaRunner', useExisting: SagaRunner }],
  exports: [SagaRunner, 'SagaRunner'],
})
export class SagaModule {}
