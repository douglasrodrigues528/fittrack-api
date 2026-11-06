import {
  DEFAULT_SIGNUPS_PER_IP,
  SIGNUP_WINDOW_MS,
  SignupLimitService,
  TooManySignupsException,
  signupLimitFrom,
} from './signup-limit.service';

describe('SignupLimitService', () => {
  let now = 0;
  const service = () => new SignupLimitService(5, () => now);

  beforeEach(() => {
    now = 1_000_000;
  });

  it('permite 5 contas por IP por hora e recusa a 6ª com 429', () => {
    const limit = service();
    for (let i = 0; i < 5; i += 1) {
      expect(() => limit.assertAllowed('203.0.113.7')).not.toThrow();
      limit.recordSignup('203.0.113.7');
      now += 1000;
    }
    let error: unknown;
    try {
      limit.assertAllowed('203.0.113.7');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TooManySignupsException);
    const exception = error as TooManySignupsException;
    expect(exception.getStatus()).toBe(429);
    // Libera quando o 1º cadastro sai da janela de 1 hora.
    expect(exception.retryAfterSeconds).toBe(SIGNUP_WINDOW_MS / 1000 - 5);
  });

  it('cada IP tem a sua cota', () => {
    const limit = service();
    for (let i = 0; i < 5; i += 1) limit.recordSignup('203.0.113.7');
    expect(() => limit.assertAllowed('198.51.100.1')).not.toThrow();
  });

  it('a janela desliza: depois de 1 hora a cota volta', () => {
    const limit = service();
    for (let i = 0; i < 5; i += 1) limit.recordSignup('203.0.113.7');
    expect(() => limit.assertAllowed('203.0.113.7')).toThrow(
      TooManySignupsException,
    );
    now += SIGNUP_WINDOW_MS + 1;
    expect(() => limit.assertAllowed('203.0.113.7')).not.toThrow();
  });

  it('sem IP (produção sem TRUST_PROXY) o limite por IP fica desligado', () => {
    const limit = service();
    for (let i = 0; i < 20; i += 1) limit.recordSignup(null);
    expect(() => limit.assertAllowed(null)).not.toThrow();
  });

  it('SIGNUP_LIMIT_PER_HOUR: padrão 5; valores inválidos voltam ao padrão', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(DEFAULT_SIGNUPS_PER_IP).toBe(5);
    expect(signupLimitFrom(undefined)).toBe(5);
    expect(signupLimitFrom('')).toBe(5);
    expect(signupLimitFrom('20')).toBe(20);
    expect(signupLimitFrom('0')).toBe(5);
    expect(signupLimitFrom('abc')).toBe(5);
    expect(signupLimitFrom('2.5')).toBe(5);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
