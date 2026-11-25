import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ENV } from '../../common/config';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [LedgerModule, JwtModule.register({ global: true, secret: ENV.jwtSecret, signOptions: { expiresIn: '12h' } })],
  controllers: [AuthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, AuthService],
})
export class AuthModule {}
