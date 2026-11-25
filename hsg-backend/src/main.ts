import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ENV } from './common/config';
import { ErrorEnvelopeFilter } from './common/http-exception.filter';
import { installBigIntJson } from './common/json';

async function bootstrap() {
  installBigIntJson();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: ENV.webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
  await app.listen(ENV.apiPort);
  console.log(`HSG API on http://localhost:${ENV.apiPort}/api`);
}
bootstrap();
