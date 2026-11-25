import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommonModule } from './common/common.module';
import { SagaModule } from './modules/saga/saga.module';

/** Worker process: no HTTP. SagaModule's runner is started from worker.ts. */
@Module({ imports: [CommonModule, JwtModule.register({ global: true, secret: 'unused-in-worker' }), SagaModule] })
export class WorkerModule {}
