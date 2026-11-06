import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { LoginDto } from '../../../application/dto/login.dto';
import { AuthService } from '../../../application/services/auth/auth.service';
import { TooManyLoginAttemptsException } from '../../../application/services/auth/login-attempts.service';
import { clientIp } from '../../../shared/http/client-ip';

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
      return await this.authService.login(
        data,
        clientIp(request, this.configService),
      );
    } catch (error) {
      if (error instanceof TooManyLoginAttemptsException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}