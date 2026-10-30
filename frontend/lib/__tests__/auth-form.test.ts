import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  PASSWORD_MIN,
  loginFailureMessage,
  registerFailure,
  validateLogin,
  validateRegister,
} from '../auth-form';

describe('validateLogin', () => {
  it('campos vazios: uma mensagem clara por campo', () => {
    assert.deepEqual(validateLogin({ email: '', password: '' }), {
      email: 'Informe seu e-mail.',
      password: 'Informe sua senha.',
    });
  });

  it('e-mail inválido e válido (espaços nas pontas são tolerados)', () => {
    assert.equal(validateLogin({ email: 'ana@', password: 'x' }).email, 'Digite um e-mail válido, como nome@exemplo.com.');
    assert.deepEqual(validateLogin({ email: ' ana@exemplo.com ', password: 'x' }), {});
  });
});

describe('validateRegister', () => {
  it('segue a regra da API: nome, e-mail válido e senha com pelo menos 6 caracteres', () => {
    assert.equal(PASSWORD_MIN, 6);
    assert.deepEqual(validateRegister({ name: ' ', email: '', password: '' }), {
      name: 'Informe seu nome.',
      email: 'Informe seu e-mail.',
      password: 'Crie uma senha.',
    });
    assert.equal(
      validateRegister({ name: 'Ana', email: 'ana@exemplo.com', password: '12345' }).password,
      'A senha precisa ter pelo menos 6 caracteres.',
    );
    assert.deepEqual(validateRegister({ name: 'Ana', email: 'ana@exemplo.com', password: '123456' }), {});
  });
});

describe('mensagens da API', () => {
  it('login: sem conexão, credenciais erradas (sem revelar se o e-mail existe), bloqueio e genérico', () => {
    assert.equal(loginFailureMessage({}), 'Não foi possível conectar. Verifique sua internet e tente novamente.');
    assert.equal(
      loginFailureMessage({ status: 401, message: 'Email ou senha inválidos' }),
      'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    );
    assert.equal(
      loginFailureMessage({ status: 429, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }),
      'Muitas tentativas de login. Tente novamente em 15 minutos.',
    );
    assert.equal(loginFailureMessage({ status: 400, message: ['email must be an email'] }), 'Confira o e-mail e a senha e tente novamente.');
    assert.equal(loginFailureMessage({ status: 500 }), 'Não foi possível entrar agora. Tente novamente em instantes.');
  });

  it('cadastro: e-mail repetido e validação da API viram erro no campo, em português', () => {
    assert.deepEqual(registerFailure({ status: 409, message: 'E-mail já cadastrado' }), {
      fields: { email: 'Este e-mail já tem uma conta. Entre com ele ou use outro e-mail.' },
    });
    assert.deepEqual(registerFailure({ status: 400, message: ['password must be longer than or equal to 6 characters', 'email must be an email'] }), {
      fields: {
        email: 'Digite um e-mail válido, como nome@exemplo.com.',
        password: 'A senha precisa ter pelo menos 6 caracteres.',
      },
    });
    assert.deepEqual(registerFailure({ status: 400, message: ['algo inesperado'] }), {
      fields: {},
      form: 'Confira os dados informados e tente novamente.',
    });
    assert.equal(registerFailure({}).form, 'Não foi possível conectar. Verifique sua internet e tente novamente.');
  });
});
