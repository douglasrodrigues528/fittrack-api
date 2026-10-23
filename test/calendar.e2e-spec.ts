/**
 * Calendário de consistência (GET /sessions/calendar), de ponta a ponta, contra um PostgreSQL
 * DESCARTÁVEL. Nunca aponte para o banco de desenvolvimento.
 *
 *   E2E_DB_NAME=fittrack_journey_e2e npm run test:e2e -- calendar
 */
// As respostas do supertest são JSON sem tipo (`any`); aqui elas são verificadas pelos próprios expects.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';

const dbName = process.env.E2E_DB_NAME ?? '';
const enabled = /(_e2e|_test)$/.test(dbName);
const describeE2E = enabled ? describe : describe.skip;

const run = Date.now().toString(36);
const PASSWORD = 'senha-forte-1';

// Setembro de 2026 no fuso de São Paulo (UTC−3): [01/09 00:00, 01/10 00:00) locais.
const SP_SEPTEMBER = {
  from: '2026-09-01T03:00:00.000Z',
  to: '2026-10-01T03:00:00.000Z',
};

describeE2E('Calendário de consistência (e2e)', () => {
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());

  async function signUp(label: string) {
    const email = `${label}-${run}@exemplo.test`;
    await api()
      .post('/users')
      .send({ name: label, email, password: PASSWORD })
      .expect(201);
    const login = await api()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { auth: { Authorization: `Bearer ${login.body.access_token}` } };
  }

  /** Registra uma sessão concluída com horário escolhido (rota já existente). */
  async function completed(
    auth: Record<string, string>,
    title: string,
    startedAt: string,
    minutes = 60,
  ) {
    const finishedAt = new Date(
      Date.parse(startedAt) + minutes * 60_000,
    ).toISOString();
    const res = await api()
      .post('/sessions')
      .set(auth)
      .send({
        title,
        startedAt,
        finishedAt,
        exercises: [
          { name: 'Supino', sets: [{ type: 'normal', weight: 40, reps: 10 }] },
        ],
      })
      .expect(201);
    return res.body.id as string;
  }

  const calendar = (
    auth: Record<string, string>,
    range: { from: string; to: string },
  ) => api().get('/sessions/calendar').query(range).set(auth);

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.DB_NAME = dbName;
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
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('devolve só sessões concluídas do usuário no período, inclusive várias no mesmo dia', async () => {
    const user = await signUp('cal');
    const other = await signUp('cal-outro');

    const morning = await completed(
      user.auth,
      'Peito',
      '2026-09-10T11:00:00.000Z',
    );
    const evening = await completed(
      user.auth,
      'Corrida',
      '2026-09-10T22:00:00.000Z',
      30,
    );
    const later = await completed(
      user.auth,
      'Pernas',
      '2026-09-15T12:00:00.000Z',
      75,
    );
    await completed(user.auth, 'Agosto', '2026-08-20T12:00:00.000Z'); // fora do período
    await completed(other.auth, 'Do outro', '2026-09-10T12:00:00.000Z');

    // Em andamento e descartada não aparecem.
    await api()
      .post('/sessions/start')
      .set(user.auth)
      .send({
        progress: {
          title: 'Aberta',
          notes: '',
          restSeconds: 90,
          exercises: [],
        },
      })
      .expect(201);
    const toCancel = await api()
      .get('/sessions/active')
      .set(user.auth)
      .expect(200);
    await api()
      .post(`/sessions/${toCancel.body.session.id}/cancel`)
      .set(user.auth)
      .expect(200);

    const res = await calendar(user.auth, SP_SEPTEMBER).expect(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([
      morning,
      evening,
      later,
    ]);
    expect(res.body.data[0]).toEqual({
      id: morning,
      workoutId: null,
      origin: 'free',
      title: 'Peito',
      startedAt: '2026-09-10T11:00:00.000Z',
      finishedAt: '2026-09-10T12:00:00.000Z',
      durationSeconds: 3600,
    });
    expect(res.body.firstSessionAt).toBe('2026-08-20T12:00:00.000Z');

    // O outro usuário só vê a própria sessão; não há como pedir o calendário de outra pessoa.
    const theirs = await calendar(other.auth, SP_SEPTEMBER).expect(200);
    expect(theirs.body.data.map((s: { title: string }) => s.title)).toEqual([
      'Do outro',
    ]);
    await api().get(`/sessions/${morning}`).set(other.auth).expect(404);

    // Os detalhes (exercícios, séries, cargas) vêm da rota de detalhes já existente.
    const detail = await api()
      .get(`/sessions/${evening}`)
      .set(user.auth)
      .expect(200);
    expect(detail.body.exercises[0]).toMatchObject({
      name: 'Supino',
      sets: [{ weight: 40, reps: 10 }],
    });
  });

  it('o intervalo é [from, to): o servidor não desloca datas, só compara instantes', async () => {
    const user = await signUp('cal-fuso');
    // 23:30 de 31/08 em São Paulo = 02:30 de 01/09 em UTC.
    const lateNight = await completed(
      user.auth,
      'Noturno',
      '2026-09-01T02:30:00.000Z',
    );
    const atStart = await completed(user.auth, 'No limite', SP_SEPTEMBER.from);
    await completed(user.auth, 'Fora (= to)', SP_SEPTEMBER.to);

    const sp = await calendar(user.auth, SP_SEPTEMBER).expect(200);
    expect(sp.body.data.map((s: { id: string }) => s.id)).toEqual([atStart]);

    // O mês de agosto em São Paulo contém o treino das 23:30 de 31/08.
    const spAugust = await calendar(user.auth, {
      from: '2026-08-01T03:00:00.000Z',
      to: SP_SEPTEMBER.from,
    }).expect(200);
    expect(spAugust.body.data.map((s: { id: string }) => s.id)).toEqual([
      lateNight,
    ]);
  });

  it('valida o período e exige autenticação', async () => {
    const user = await signUp('cal-validacao');
    await calendar(user.auth, {
      from: SP_SEPTEMBER.to,
      to: SP_SEPTEMBER.from,
    }).expect(400);
    await calendar(user.auth, {
      from: SP_SEPTEMBER.from,
      to: SP_SEPTEMBER.from,
    }).expect(400);
    await calendar(user.auth, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    }).expect(400);
    await calendar(user.auth, { from: 'ontem', to: SP_SEPTEMBER.to }).expect(
      400,
    );
    await api()
      .get('/sessions/calendar')
      .query({ from: SP_SEPTEMBER.from })
      .set(user.auth)
      .expect(400);
    await api().get('/sessions/calendar').query(SP_SEPTEMBER).expect(401);

    const empty = await calendar(user.auth, SP_SEPTEMBER).expect(200);
    expect(empty.body).toMatchObject({ data: [], firstSessionAt: null });
  });
});
