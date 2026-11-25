import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PostingsService } from './postings.service';
import { LedgerController } from './ledger.controller';

@Module({ controllers: [LedgerController], providers: [LedgerService, PostingsService], exports: [LedgerService, PostingsService] })
export class LedgerModule {}
