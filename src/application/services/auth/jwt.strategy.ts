import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { getJwtSecret } from '../../../shared/config/app-config';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: getJwtSecret(configService),
    });
  }

  /**
   * Além da assinatura e da validade, confere no banco se a conta ainda existe e se o token
   * é da versão atual (trocar a senha incrementa a versão). Tokens antigos sem `tv` contam como 0.
   */
  async validate(payload: { sub: string; email: string; tv?: number }) {
    const currentVersion = await this.usersService.getTokenVersion(payload.sub);
    if (currentVersion === null || (payload.tv ?? 0) !== currentVersion) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    return {
      userId: payload.sub,
      email: payload.email,
    };
  }
}
