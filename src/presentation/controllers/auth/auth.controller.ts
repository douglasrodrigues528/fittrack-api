import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { LoginDto } from '../../../application/dto/login.dto';
import { AuthService } from '../../../application/services/auth/auth.service';
import { TooManyLoginAttemptsException } from '../../../application/services/auth/login-attempts.service';
import { isProduction } from '../../../shared/config/app-config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() data: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.authService.login(data, this.clientIp(request));
    } catch (error) {
      if (error instanceof TooManyLoginAttemptsException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  /**
   * IP para o limite por IP. Em produção atrás de proxy, sem TRUST_PROXY todos os clientes
   * teriam o IP do proxy (um bloqueio pararia o site inteiro): nesse caso o limite por IP fica
   * desligado e vale só o limite por conta.
   */
  private clientIp(request: Request): string | null {
    const trustsProxy = Boolean(this.configService.get<string>('TRUST_PROXY'));
    if (isProduction(this.configService) && !trustsProxy) return null;
    return request.ip ?? null;
  }
}