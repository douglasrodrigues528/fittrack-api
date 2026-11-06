/**
 * Health check, cabeçalhos de segurança e limite de cadastro por IP, via HTTP.
 * Não usa banco: o módulo de teste não tem TypeORM, então o /health provadamente
 * responde sem consultar o PostgreSQL.
 *
 *   npm run test:e2e -- health-security
 */
// As respostas do supertest são JSON sem tipo (`any`); aqui elas são verificadas pelos próprios expects.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { SignupLimitService } from '../src/application/services/users/signup-limit.service';
import { UsersService } from '../src/application/services/users/users.service';
import { HealthController } from '../src/presentation/controllers/health/health.controller';
import { UsersController } from '../src/presentation/controllers/users/users.controller';
import { applySecurityHeaders } from '../src/shared/http/security-headers';

describe('Health, cabeçalhos e limite de cadastro (HTTP, sem banco)', () => {
  let app: NestExpressApplication;
  const created: string[] = [];
  const usersService = {
    create: jest.fn((data: { email: string }) => {
      created.push(data.email);
      return Promise.resolve({ id: `id-${created.length}`, email: data.email });
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // Como no Render: produção atrás de proxy, com TRUST_PROXY=1.
          load: [() => ({ NODE_ENV: 'production', TRUST_PROXY: '1' })],
        }),
      ],
      controllers: [HealthController, UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: SignupLimitService, useValue: new SignupLimitService(5) },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    applySecurityHeaders(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const signup = (ip: string, n: number) =>
    api()
      .post('/users')
      .set('X-Forwarded-For', ip)
      .send({
        name: 'Teste',
        email: `conta-${ip}-${n}@exemplo.test`,
        password: 'senha-forte-1',
      });

  it('GET /health: 200, sem autenticação e sem cache', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cabeçalhos de segurança em todas as respostas (inclusive erros)', async () => {
    for (const res of [
      await api().get('/health'),
      await api().get('/rota-que-nao-existe').expect(404),
    ]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('cadastro: 5 contas por IP por hora; a 6ª recebe 429 com Retry-After', async () => {
    for (let n = 1; n <= 5; n += 1) {
      await signup('203.0.113.10', n).expect(201);
    }
    const blocked = await signup('203.0.113.10', 6).expect(429);
    expect(blocked.body.message).toMatch(/Muitas contas criadas/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      created.filter((email) => email.includes('203.0.113.10')),
    ).toHaveLength(5);
  });

  it('outro IP (X-Forwarded-For via proxy confiável) continua podendo se cadastrar', async () => {
    await signup('198.51.100.20', 1).expect(201);
  });

  it('cadastro inválido não consome a cota', async () => {
    for (let n = 0; n < 6; n += 1) {
      await api()
        .post('/users')
        .set('X-Forwarded-For', '192.0.2.30')
        .send({ name: '', email: 'invalido', password: '1' })
        .expect(400);
    }
    await signup('192.0.2.30', 1).expect(201);
  });
});
