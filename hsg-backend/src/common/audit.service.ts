import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { newId } from './ids';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  log(actor: string, action: string, entity: string, entityId: string, data?: unknown) {
    return this.prisma.auditLog.create({ data: { id: newId('al'), actor, action, entity, entityId, data: (data ?? undefined) as any } });
  }
}
