import { Module } from '@nestjs/common';
import { LiquidityService } from './liquidity.service';
import { SimulatedAdapter } from './simulated-adapter';
import { BridgeAdapter } from './bridge-adapter';

@Module({
  providers: [LiquidityService, SimulatedAdapter, BridgeAdapter],
  exports: [LiquidityService, SimulatedAdapter, BridgeAdapter],
})
export class LiquidityModule {}
