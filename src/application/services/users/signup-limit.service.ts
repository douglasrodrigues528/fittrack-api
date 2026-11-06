import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
/** Contas novas por IP dentro da janela, se SIGNUP_LIMIT_PER_HOUR não definir outro valor. */
export const DEFAULT_SIGNUPS_PER_IP = 5;
/** Teto de IPs em memória, para o mapa não crescer sem limite sob ataque. */
const MAX_TRACKED_IPS = 50_000;

/** Lê SIGNUP_LIMIT_PER_HOUR; valor ausente ou inválido usa o padrão. */
export function signupLimitFrom(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SIGNUPS_PER_IP;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.warn(
      `[AVISO] SIGNUP_LIMIT_PER_HOUR inválido (${JSON.stringify(raw)}); usando ${DEFAULT_SIGNUPS_PER_IP}.`,
    );
    return DEFAULT_SIGNUPS_PER_IP;
  }
  return value;
}

export class TooManySignupsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Muitas contas criadas a partir desta rede. Tente novamente em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Conta as contas criadas por IP, em memória (uma instância da API), numa janela
 * deslizante de 1 hora. Mesmo modelo do limite de tentativas de login.
 */
@Injectable()
export class SignupLimitService {
  private readonly signups = new Map<string, number[]>();

  /** `now` é injetável para testes. */
  constructor(
    readonly maxPerIp: number = DEFAULT_SIGNUPS_PER_IP,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cadastros ainda dentro da janela (descarta os antigos). */
  private recent(ip: string): number[] {
    const cutoff = this.now() - SIGNUP_WINDOW_MS;
    const list = (this.signups.get(ip) ?? []).filter((at) => at > cutoff);
    if (list.length === 0) this.signups.delete(ip);
    else this.signups.set(ip, list);
    return list;
  }

  /** Lança 429 se o IP já criou o máximo de contas. Chamar ANTES de criar a conta. */
  assertAllowed(ip: string | null) {
    if (!ip) return;
    const list = this.recent(ip);
    if (list.length >= this.maxPerIp) {
      const retryAfter = Math.max(
        1,
        Math.ceil((list[0] + SIGNUP_WINDOW_MS - this.now()) / 1000),
      );
      throw new TooManySignupsException(retryAfter);
    }
  }

  /** Conta criada com sucesso (falhas, como e-mail repetido, não contam). */
  recordSignup(ip: string | null) {
    if (!ip) return;
    if (!this.signups.has(ip) && this.signups.size >= MAX_TRACKED_IPS) {
      // Remove o IP mais antigo (ordem de inserção do Map).
      const oldest = this.signups.keys().next().value;
      if (oldest !== undefined) this.signups.delete(oldest);
    }
    this.signups.set(ip, [...this.recent(ip), this.now()]);
  }
}
