import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { FaultsService } from './faults.service';
import { SagaQueue } from './saga-queue';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, FaultsService, SagaQueue, AuditService],
  exports: [PrismaService, RedisService, FaultsService, SagaQueue, AuditService],
})
export class CommonModule {}
