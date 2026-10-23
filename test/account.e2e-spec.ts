/**
 * Conta e autenticação (exclusão de conta, troca de e-mail, troca de senha, tentativas de login),
 * de ponta a ponta, contra um PostgreSQL DESCARTÁVEL. Nunca aponte para o banco de desenvolvimento.
 *
 *   E2E_DB_NAME=fittrack_journey_e2e npm run test:e2e -- account
 */
// As respostas do supertest são JSON sem tipo (`any`); aqui elas são verificadas pelos próprios expects.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

const dbName = process.env.E2E_DB_NAME ?? '';
const enabled = /(_e2e|_test)$/.test(dbName);
const describeE2E = enabled ? describe : describe.skip;

const run = Date.now().toString(36);
const PASSWORD = 'senha-forte-1';

describeE2E('Conta e autenticação (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const api = () => request(app.getHttpServer());

  async function signUp(label: string) {
    const email = `${label}-${run}@exemplo.test`;
    const created = await api()
      .post('/users')
      .send({ name: label, email, password: PASSWORD })
      .expect(201);
    const login = await api()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return {
      id: created.body.id as string,
      email,
      auth: { Authorization: `Bearer ${login.body.access_token}` },
    };
  }

  const count = async (sql: string, params: unknown[]) => {
    const rows: { n: number }[] = await dataSource.query(sql, params);
    return rows[0].n;
  };

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.DB_NAME = dbName;
    // E2E_SYNCHRONIZE=false testa num banco criado só pelas migrations (como em produção).
    process.env.DB_SYNCHRONIZE = process.env.E2E_SYNCHRONIZE ?? 'true';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    expect(dataSource.options.database).toBe(dbName);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  describe('A2 · exclusão de conta', () => {
    it('exclui a conta com treinos, sessões e séries, sem tocar nos dados de outro usuário', async () => {
      const user = await signUp('excluir');
      const other = await signUp('excluir-vizinho');

      const workout = await api()
        .post('/workouts')
        .set(user.auth)
        .send({
          title: 'A',
          exercises: [{ name: 'Supino', sets: [{ weight: 20, reps: 10 }] }],
        })
        .expect(201);
      await api()
        .post('/workouts')
        .set(user.auth)
        .send({ title: 'B' })
        .expect(201);
      const done = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({
          workoutId: workout.body.id,
          progress: { title: '', notes: '', restSeconds: 90, exercises: [] },
        })
        .expect(201);
      await api()
        .post(`/sessions/${done.body.id}/finish`)
        .set(user.auth)
        .send({
          title: 'A',
          exercises: [
            {
              name: 'Supino',
              sets: [{ type: 'normal', weight: 20, reps: 10 }],
            },
          ],
        })
        .expect(200);
      // Uma sessão em andamento também deve sair.
      await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({
          progress: {
            title: 'Livre',
            notes: '',
            restSeconds: 90,
            exercises: [],
          },
        })
        .expect(201);
      await api()
        .post('/workouts')
        .set(other.auth)
        .send({ title: 'Do vizinho' })
        .expect(201);

      // Outro usuário não pode excluir esta conta.
      await api().delete(`/users/${user.id}`).set(other.auth).expect(403);

      await api().delete(`/users/${user.id}`).set(user.auth).expect(200);

      expect(
        await count('SELECT count(*)::int AS n FROM users WHERE id = $1', [
          user.id,
        ]),
      ).toBe(0);
      expect(
        await count(
          'SELECT count(*)::int AS n FROM workouts WHERE "userId" = $1',
          [user.id],
        ),
      ).toBe(0);
      expect(
        await count(
          'SELECT count(*)::int AS n FROM workout_sessions WHERE "userId" = $1',
          [user.id],
        ),
      ).toBe(0);
      expect(
        await count(
          'SELECT count(*)::int AS n FROM session_sets WHERE "sessionId" = $1',
          [done.body.id],
        ),
      ).toBe(0);
      expect(
        await count(
          'SELECT count(*)::int AS n FROM workouts WHERE "userId" = $1',
          [other.id],
        ),
      ).toBe(1);

      await api()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
    });

    it('a restrição do banco também apaga os treinos em cascata', async () => {
      const [{ rule }] = await dataSource.query(
        `SELECT confdeltype AS rule FROM pg_constraint WHERE conname = 'FK_65ff5fd1913246288adad5dc75a'`,
      );
      expect(rule).toBe('c'); // c = CASCADE
    });
  });
  describe('A3 · troca de e-mail', () => {
    it('e-mail de outra conta recebe 409 (não 500) e nada muda', async () => {
      const a = await signUp('email-a');
      const b = await signUp('email-b');
      const res = await api()
        .patch(`/users/${a.id}`)
        .set(a.auth)
        .send({ email: b.email })
        .expect(409);
      expect(res.body.message).toBe('E-mail já cadastrado');
      expect(
        (await api().get('/users/me').set(a.auth).expect(200)).body.email,
      ).toBe(a.email);
    });

    it('trocar para um e-mail livre funciona e o login passa a usar o novo; o próprio e-mail é aceito', async () => {
      const a = await signUp('email-livre');
      const novo = `novo-${run}@exemplo.test`;
      await api()
        .patch(`/users/${a.id}`)
        .set(a.auth)
        .send({ email: a.email, name: 'Mesmo e-mail' })
        .expect(200);
      const res = await api()
        .patch(`/users/${a.id}`)
        .set(a.auth)
        .send({ email: novo })
        .expect(200);
      expect(res.body.email).toBe(novo);
      expect(res.body.password).toBeUndefined();
      await api()
        .post('/auth/login')
        .send({ email: novo, password: PASSWORD })
        .expect(201);
    });

    it('duas contas pedindo o mesmo e-mail ao mesmo tempo: uma consegue, a outra recebe 409', async () => {
      const a = await signUp('corrida-a');
      const b = await signUp('corrida-b');
      const disputado = `disputado-${run}@exemplo.test`;
      const results = await Promise.all([
        api().patch(`/users/${a.id}`).set(a.auth).send({ email: disputado }),
        api().patch(`/users/${b.id}`).set(b.auth).send({ email: disputado }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });
  describe('A4 · troca de senha', () => {
    it('exige a senha atual: sem ela 400, errada 403, e a senha não muda', async () => {
      const user = await signUp('senha-exige');
      await api()
        .patch(`/users/${user.id}`)
        .set(user.auth)
        .send({ password: 'nova-senha-1' })
        .expect(400);
      const wrong = await api()
        .patch(`/users/${user.id}`)
        .set(user.auth)
        .send({ password: 'nova-senha-1', currentPassword: 'chute' })
        .expect(403);
      expect(wrong.body.message).toBe('Senha atual incorreta.');
      await api()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(201);
      await api().get('/users/me').set(user.auth).expect(200);
    });

    it('com a senha atual: troca, revoga os tokens de todos os aparelhos e só a nova senha entra', async () => {
      const user = await signUp('senha-troca');
      const otherDevice = await api()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(201);
      const otherAuth = {
        Authorization: `Bearer ${otherDevice.body.access_token}`,
      };

      const res = await api()
        .patch(`/users/${user.id}`)
        .set(user.auth)
        .send({ password: 'nova-senha-1', currentPassword: PASSWORD })
        .expect(200);
      expect(res.body.password).toBeUndefined();
      expect(res.body.tokenVersion).toBeUndefined();

      await api().get('/users/me').set(user.auth).expect(401);
      await api().get('/workouts').set(otherAuth).expect(401);
      await api()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);

      const fresh = await api()
        .post('/auth/login')
        .send({ email: user.email, password: 'nova-senha-1' })
        .expect(201);
      await api()
        .get('/users/me')
        .set({ Authorization: `Bearer ${fresh.body.access_token}` })
        .expect(200);
    });

    it('token de conta excluída deixa de valer imediatamente', async () => {
      const user = await signUp('senha-excluida');
      await api().delete(`/users/${user.id}`).set(user.auth).expect(200);
      await api().get('/workouts').set(user.auth).expect(401);
    });

    it('tokens emitidos antes desta mudança (sem versão) continuam válidos até a senha ser trocada', async () => {
      const user = await signUp('senha-legado');
      const legacy = app
        .get(JwtService)
        .sign({ sub: user.id, email: user.email });
      const legacyAuth = { Authorization: `Bearer ${legacy}` };
      await api().get('/users/me').set(legacyAuth).expect(200);
      await api()
        .patch(`/users/${user.id}`)
        .set(user.auth)
        .send({ password: 'nova-senha-1', currentPassword: PASSWORD })
        .expect(200);
      await api().get('/users/me').set(legacyAuth).expect(401);
    });
  });
  describe('A5 · limite de tentativas de login', () => {
    it('20 senhas erradas seguidas: 5 recebem 401 e as demais 429 com Retry-After', async () => {
      const user = await signUp('forca-bruta');
      const statuses: number[] = [];
      let last: request.Response | undefined;
      for (let i = 0; i < 20; i += 1) {
        last = await api()
          .post('/auth/login')
          .send({ email: user.email, password: `errada-${i}` });
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5).every((status) => status === 429)).toBe(true);
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      expect(last!.body.message).toMatch(/Muitas tentativas de login/);

      // Bloqueada, nem a senha certa entra; mas tokens já emitidos continuam valendo.
      await api()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(429);
      await api().get('/users/me').set(user.auth).expect(200);
    });

    it('o bloqueio é da conta: outra conta entra normalmente', async () => {
      const victim = await signUp('forca-alvo');
      const bystander = await signUp('forca-outro');
      for (let i = 0; i < 5; i += 1) {
        await api()
          .post('/auth/login')
          .send({ email: victim.email, password: 'errada' })
          .expect(401);
      }
      await api()
        .post('/auth/login')
        .send({ email: victim.email, password: PASSWORD })
        .expect(429);
      await api()
        .post('/auth/login')
        .send({ email: bystander.email, password: PASSWORD })
        .expect(201);
    });

    it('erros esporádicos não bloqueiam: um login certo zera a contagem', async () => {
      const user = await signUp('forca-esporadico');
      for (let round = 0; round < 3; round += 1) {
        for (let i = 0; i < 4; i += 1) {
          await api()
            .post('/auth/login')
            .send({ email: user.email, password: 'errada' })
            .expect(401);
        }
        await api()
          .post('/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(201);
      }
    });
  });
});
