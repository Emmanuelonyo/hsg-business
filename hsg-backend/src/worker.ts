import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { installBigIntJson } from './common/json';

/**
 * Worker entrypoint. Agent D: export a `SagaRunner` provider from SagaModule with `start()` and `stop()`
 * and this file will start it. (Resolved by string token to keep foundation compiling before it exists.)
 */
async function bootstrap() {
  installBigIntJson();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const runner: any = app.get('SagaRunner', { strict: false });
  await runner.start();
  console.log('HSG worker started');
}
bootstrap();
