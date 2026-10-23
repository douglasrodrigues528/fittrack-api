import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { LoginDto } from '../../dto/login.dto';
import { UsersService } from '../users/users.service';
import { LoginAttemptsService } from './login-attempts.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  /**
   * `ip` é null quando o limite por IP está desligado (produção atrás de proxy sem TRUST_PROXY).
   * Contas bloqueadas recebem 429 antes de a senha ser conferida.
   */
  async login(data: LoginDto, ip: string | null = null) {
    this.loginAttempts.assertAllowed(data.email, ip);

    const user = await this.usersService.findByEmailWithPassword(
      data.email,
    );

    // E-mail inexistente conta como falha também: não revela quais contas existem.
    if (!user) {
      this.loginAttempts.recordFailure(data.email, ip);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    const passwordMatch = await bcrypt.compare(
      data.password,
      user.password,
    );

    if (!passwordMatch) {
      this.loginAttempts.recordFailure(data.email, ip);
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    this.loginAttempts.recordSuccess(data.email);

    const payload = {
      sub: user.id,
      email: user.email,
      // Versão dos tokens: muda ao trocar a senha, invalidando os tokens anteriores.
      tv: user.tokenVersion,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}