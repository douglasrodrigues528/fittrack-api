import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Falhas permitidas por conta (e-mail) dentro da janela. */
export const MAX_FAILURES_PER_ACCOUNT = 5;
/** Falhas permitidas por IP dentro da janela (quem testa muitas contas diferentes). */
export const MAX_FAILURES_PER_IP = 50;
/** Teto de chaves em memória, para o mapa não crescer sem limite sob ataque. */
const MAX_TRACKED_KEYS = 50_000;

export class TooManyLoginAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Muitas tentativas de login. Tente novamente em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Conta tentativas de login com senha errada, em memória (uma instância da API).
 * Bloqueia por conta e, opcionalmente, por IP, numa janela deslizante.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly failures = new Map<string, number[]>();

  /** `now` é injetável para testes. */
  constructor(private readonly now: () => number = Date.now) {}

  private static accountKey(email: string) {
    return `account:${email.trim().toLowerCase()}`;
  }

  private static ipKey(ip: string) {
    return `ip:${ip}`;
  }

  /** Falhas ainda dentro da janela (descarta as antigas). */
  private recent(key: string): number[] {
    const cutoff = this.now() - LOGIN_WINDOW_MS;
    const list = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  private retryAfter(list: number[]): number {
    return Math.max(
      1,
      Math.ceil((list[0] + LOGIN_WINDOW_MS - this.now()) / 1000),
    );
  }

  /** Lança 429 se a conta (ou o IP) já atingiu o limite. Chamar ANTES de conferir a senha. */
  assertAllowed(email: string, ip: string | null) {
    const account = this.recent(LoginAttemptsService.accountKey(email));
    if (account.length >= MAX_FAILURES_PER_ACCOUNT) {
      throw new TooManyLoginAttemptsException(this.retryAfter(account));
    }
    if (ip) {
      const byIp = this.recent(LoginAttemptsService.ipKey(ip));
      if (byIp.length >= MAX_FAILURES_PER_IP) {
        throw new TooManyLoginAttemptsException(this.retryAfter(byIp));
      }
    }
  }

  recordFailure(email: string, ip: string | null) {
    const keys = [LoginAttemptsService.accountKey(email)];
    if (ip) keys.push(LoginAttemptsService.ipKey(ip));
    for (const key of keys) {
      if (!this.failures.has(key) && this.failures.size >= MAX_TRACKED_KEYS) {
        // Remove a chave mais antiga (ordem de inserção do Map).
        const oldest = this.failures.keys().next().value;
        if (oldest !== undefined) this.failures.delete(oldest);
      }
      this.failures.set(key, [...this.recent(key), this.now()]);
    }
  }

  /** Login certo: zera as falhas da conta (as do IP continuam valendo). */
  recordSuccess(email: string) {
    this.failures.delete(LoginAttemptsService.accountKey(email));
  }
}
