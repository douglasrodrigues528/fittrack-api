import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  LOGIN_WINDOW_MS,
  LoginAttemptsService,
  MAX_FAILURES_PER_ACCOUNT,
  MAX_FAILURES_PER_IP,
  TooManyLoginAttemptsException,
} from './login-attempts.service';

describe('LoginAttemptsService (A5)', () => {
  let clock: number;
  let attempts: LoginAttemptsService;

  beforeEach(() => {
    clock = Date.parse('2026-10-22T12:00:00Z');
    attempts = new LoginAttemptsService(() => clock);
  });

  const fail = (
    times: number,
    email = 'a@a.com',
    ip: string | null = '1.1.1.1',
  ) => {
    for (let i = 0; i < times; i += 1) attempts.recordFailure(email, ip);
  };

  it(`bloqueia a conta na ${MAX_FAILURES_PER_ACCOUNT}ª falha e informa quando tentar de novo`, () => {
    fail(MAX_FAILURES_PER_ACCOUNT - 1);
    expect(() => attempts.assertAllowed('a@a.com', '1.1.1.1')).not.toThrow();
    fail(1);
    try {
      attempts.assertAllowed('a@a.com', '9.9.9.9'); // outro IP: a conta continua bloqueada
      throw new Error('deveria bloquear');
    } catch (error) {
      expect(error).toBeInstanceOf(TooManyLoginAttemptsException);
      expect((error as TooManyLoginAttemptsException).getStatus()).toBe(429);
      expect((error as TooManyLoginAttemptsException).retryAfterSeconds).toBe(
        LOGIN_WINDOW_MS / 1000,
      );
    }
  });

  it('o e-mail é comparado sem diferenciar maiúsculas e espaços', () => {
    fail(MAX_FAILURES_PER_ACCOUNT, ' A@A.com ');
    expect(() => attempts.assertAllowed('a@a.com', null)).toThrow(
      TooManyLoginAttemptsException,
    );
  });

  it('libera depois da janela (janela deslizante)', () => {
    fail(MAX_FAILURES_PER_ACCOUNT);
    clock += LOGIN_WINDOW_MS - 1000;
    expect(() => attempts.assertAllowed('a@a.com', null)).toThrow(
      TooManyLoginAttemptsException,
    );
    clock += 1001;
    expect(() => attempts.assertAllowed('a@a.com', null)).not.toThrow();
  });

  it('login certo zera as falhas da conta', () => {
    fail(MAX_FAILURES_PER_ACCOUNT - 1);
    attempts.recordSuccess('a@a.com');
    fail(MAX_FAILURES_PER_ACCOUNT - 1);
    expect(() => attempts.assertAllowed('a@a.com', null)).not.toThrow();
  });

  it('outra conta não é afetada', () => {
    fail(MAX_FAILURES_PER_ACCOUNT, 'a@a.com', null);
    expect(() => attempts.assertAllowed('b@b.com', null)).not.toThrow();
  });

  it('bloqueia o IP que testa muitas contas diferentes; sem IP, só vale o limite por conta', () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1)
      attempts.recordFailure(`u${i}@a.com`, '6.6.6.6');
    expect(() => attempts.assertAllowed('nova@a.com', '6.6.6.6')).toThrow(
      TooManyLoginAttemptsException,
    );
    expect(() => attempts.assertAllowed('nova@a.com', '7.7.7.7')).not.toThrow();
    expect(() => attempts.assertAllowed('nova@a.com', null)).not.toThrow();
  });
});

describe('AuthService.login com limite de tentativas (A5)', () => {
  const findByEmailWithPassword = jest.fn();
  const signAsync = jest.fn().mockResolvedValue('token');
  const users = { findByEmailWithPassword } as unknown as UsersService;
  const jwt = {
    signAsync,
  } as unknown as JwtService;
  let attempts: LoginAttemptsService;
  let auth: AuthService;

  beforeEach(async () => {
    findByEmailWithPassword.mockReset();
    findByEmailWithPassword.mockResolvedValue({
      id: 'u1',
      email: 'a@a.com',
      password: await bcrypt.hash('certa-123', 4),
      tokenVersion: 0,
    });
    attempts = new LoginAttemptsService();
    auth = new AuthService(users, jwt, attempts);
  });

  it('bloqueado, recusa até a senha certa sem consultar o banco', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) {
      await expect(
        auth.login({ email: 'a@a.com', password: 'errada' }, '1.1.1.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    findByEmailWithPassword.mockClear();
    await expect(
      auth.login({ email: 'a@a.com', password: 'certa-123' }, '1.1.1.1'),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsException);
    expect(findByEmailWithPassword).not.toHaveBeenCalled();
  });

  it('e-mail inexistente também conta (não revela quais contas existem)', async () => {
    findByEmailWithPassword.mockResolvedValue(null);
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) {
      await expect(
        auth.login({ email: 'x@x.com', password: 'y' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      auth.login({ email: 'x@x.com', password: 'y' }),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsException);
  });

  it('login certo devolve o token com a versão e zera as falhas', async () => {
    await expect(
      auth.login({ email: 'a@a.com', password: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      auth.login({ email: 'a@a.com', password: 'certa-123' }),
    ).resolves.toEqual({ access_token: 'token' });
    expect(signAsync).toHaveBeenCalledWith({
      sub: 'u1',
      email: 'a@a.com',
      tv: 0,
    });
  });
});
