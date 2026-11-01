/**
 * Validação e mensagens dos formulários de entrada (login e cadastro).
 *
 * As regras repetem as da API (CreateUserDto e LoginDto), só para avisar antes de enviar:
 * nome obrigatório, e-mail válido e senha com pelo menos PASSWORD_MIN caracteres no cadastro.
 * A API continua sendo a autoridade; as mensagens dela são traduzidas para orientações claras.
 */

/** Tamanho mínimo da senha exigido pela API (CreateUserDto: @MinLength(6)). */
export const PASSWORD_MIN = 6;

export type LoginField = 'email' | 'password';
export type RegisterField = 'name' | 'email' | 'password';
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailError(email: string): string | undefined {
  const value = email.trim();
  if (!value) return 'Informe seu e-mail.';
  if (!EMAIL_PATTERN.test(value)) return 'Digite um e-mail válido, como nome@exemplo.com.';
  return undefined;
}

export function validateLogin(values: { email: string; password: string }): FieldErrors<LoginField> {
  const errors: FieldErrors<LoginField> = {};
  const email = emailError(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = 'Informe sua senha.';
  return errors;
}

export function validateRegister(values: { name: string; email: string; password: string }): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  if (!values.name.trim()) errors.name = 'Informe seu nome.';
  const email = emailError(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = 'Crie uma senha.';
  else if (values.password.length < PASSWORD_MIN) {
    errors.password = `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  }
  return errors;
}

/** Resposta de erro da API, já extraída do axios (status ausente = sem resposta / sem conexão). */
export interface ApiFailure {
  status?: number;
  message?: unknown;
}

const NO_CONNECTION = 'Não foi possível conectar. Verifique sua internet e tente novamente.';

function messageText(message: unknown): string {
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join(' ');
  return typeof message === 'string' ? message : '';
}

/**
 * Mensagem do login. Credenciais erradas recebem sempre o mesmo texto, sem dizer se o e-mail
 * existe (a API também não diz).
 */
export function loginFailureMessage(failure: ApiFailure): string {
  if (failure.status === undefined) return NO_CONNECTION;
  if (failure.status === 401) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  if (failure.status === 429) {
    const text = messageText(failure.message);
    // A API já explica em português quanto tempo esperar.
    return text || 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.';
  }
  if (failure.status === 400) return 'Confira o e-mail e a senha e tente novamente.';
  return 'Não foi possível entrar agora. Tente novamente em instantes.';
}

/**
 * Erros do cadastro: os de um campo vão para perto dele; o resto vira um aviso geral.
 * As mensagens de validação da API vêm em inglês (class-validator) e são traduzidas pelo campo.
 */
export function registerFailure(failure: ApiFailure): { fields: FieldErrors<RegisterField>; form?: string } {
  if (failure.status === undefined) return { fields: {}, form: NO_CONNECTION };
  if (failure.status === 409) {
    return { fields: { email: 'Este e-mail já tem uma conta. Entre com ele ou use outro e-mail.' } };
  }
  if (failure.status === 400) {
    const text = messageText(failure.message).toLowerCase();
    const fields: FieldErrors<RegisterField> = {};
    if (text.includes('name')) fields.name = 'Informe seu nome.';
    if (text.includes('email')) fields.email = 'Digite um e-mail válido, como nome@exemplo.com.';
    if (text.includes('password')) fields.password = `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
    if (Object.keys(fields).length > 0) return { fields };
    return { fields: {}, form: 'Confira os dados informados e tente novamente.' };
  }
  return { fields: {}, form: 'Não foi possível criar a conta agora. Tente novamente em instantes.' };
}
