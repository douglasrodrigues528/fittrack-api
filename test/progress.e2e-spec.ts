/**
 * Evolução por exercício (GET /sessions/exercises/:exerciseId/progress), de ponta a ponta, contra
 * um PostgreSQL DESCARTÁVEL. Nunca aponte para o banco de desenvolvimento.
 *
 *   E2E_DB_NAME=fittrack_journey_e2e npm run test:e2e -- progress
 */
// As respostas do supertest são JSON sem tipo (`any`); aqui elas são verificadas pelos próprios expects.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

const dbName = process.env.E2E_DB_NAME ?? '';
const enabled = /(_e2e|_test)$/.test(dbName);
const describeE2E = enabled ? describe : describe.skip;

const run = Date.now().toString(36);
const PASSWORD = 'senha-forte-1';

// IDs exclusivos desta execução: o banco descartável pode ter dados de execuções anteriores.
const BENCH = `Prog_Bench_${run}`;
const SQUAT = `Prog_Squat_${run}`;
const EMPTY = `Prog_Empty_${run}`;

type Set = [weight: number, reps: number, type?: string];

describeE2E('Evolução por exercício (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
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
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  const toSets = (sets: Set[]) =>
    sets.map(([weight, reps, type = 'normal']) => ({ type, weight, reps }));

  /** Sessão concluída com horário escolhido (rota já existente). */
  async function completed(
    auth: Record<string, string>,
    startedAt: string,
    exercises: { id: string | null; name: string; sets: Set[] }[],
    title = 'Treino',
  ) {
    const finishedAt = new Date(Date.parse(startedAt) + 3_600_000);
    const res = await api()
      .post('/sessions')
      .set(auth)
      .send({
        title,
        startedAt,
        finishedAt: finishedAt.toISOString(),
        exercises: exercises.map((e) => ({
          ...(e.id ? { exerciseId: e.id } : {}),
          name: e.name,
          sets: toSets(e.sets),
        })),
      })
      .expect(201);
    return res.body.id as string;
  }

  const emptyProgress = (title: string) => ({
    title,
    notes: '',
    restSeconds: 90,
    exercises: [],
  });

  const progressOf = (
    auth: Record<string, string>,
    exerciseId: string,
    query: Record<string, string | number> = {},
  ) =>
    api()
      .get(`/sessions/exercises/${encodeURIComponent(exerciseId)}/progress`)
      .query(query)
      .set(auth);

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
    dataSource = app.get(DataSource);
    expect(dataSource.options.database).toBe(dbName);

    // A tabela do catálogo não vem das migrations: em produção ela é criada por
    // scripts/sync-exercises.cjs (DEPLOY.md, passo 3). Num banco criado só pelas migrations
    // (E2E_SYNCHRONIZE=false), cria-se a mesma tabela, com o DDL do script; com synchronize, nada muda.
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS exercises (
        id varchar(150) PRIMARY KEY,
        name varchar(255) NOT NULL,
        force varchar(80),
        level varchar(80),
        mechanic varchar(80),
        equipment varchar(120),
        primary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb,
        secondary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb,
        instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
        category varchar(80),
        images jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Itens do catálogo (o banco descartável não tem o catálogo importado).
    await dataSource.query(
      `INSERT INTO exercises (id, name) VALUES ($1, 'Supino reto (catálogo)'), ($2, 'Prancha (catálogo)')
       ON CONFLICT (id) DO NOTHING`,
      [BENCH, EMPTY],
    );
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('pontos cronológicos, recorde com as repetições da série certa e só sessões concluídas', async () => {
    const auth = await signUp('prog');
    const other = await signUp('prog-outro');
    const bench = (sets: Set[]) => ({ id: BENCH, name: 'Supino', sets });

    // Gravadas fora de ordem de propósito.
    const s2 = await completed(auth, '2026-09-10T22:00:00.000Z', [
      bench([
        [60, 10],
        [70, 6],
        [65, 8],
      ]),
      { id: SQUAT, name: 'Agachamento', sets: [[120, 5]] },
    ]);
    const s1 = await completed(auth, '2026-09-03T22:00:00.000Z', [
      bench([
        [50, 12],
        [55, 10],
      ]),
    ]);
    const s4 = await completed(auth, '2026-09-24T22:00:00.000Z', [
      bench([[65, 10]]),
    ]);
    const s3 = await completed(auth, '2026-09-17T22:00:00.000Z', [
      bench([
        [20, 15, 'warmup'],
        [72.5, 4],
        [72.5, 5],
        [70, 8],
      ]),
    ]);
    // Exercício diferente, em sessão própria, com carga maior: não pode contaminar o supino.
    await completed(auth, '2026-09-20T22:00:00.000Z', [
      { id: SQUAT, name: 'Agachamento', sets: [[140, 3]] },
    ]);
    // Mesmo exercício, OUTRO usuário, carga enorme.
    await completed(other, '2026-09-11T22:00:00.000Z', [bench([[500, 1]])]);

    // Descartada: as séries nunca viram histórico (mesmo que o rascunho tivesse cargas altas).
    const cancelled = await api()
      .post('/sessions/start')
      .set(auth)
      .send({ progress: emptyProgress('Descartado') })
      .expect(201);
    await api()
      .post(`/sessions/${cancelled.body.id}/cancel`)
      .set(auth)
      .expect(200);
    // Em andamento, com rascunho de 300 kg no supino: também não conta.
    await api()
      .post('/sessions/start')
      .set(auth)
      .send({
        progress: {
          ...emptyProgress('Aberto'),
          exercises: [
            {
              uid: 'e0',
              exerciseId: BENCH,
              name: 'Supino',
              sets: [
                {
                  uid: 's0',
                  type: 'normal',
                  weight: '300',
                  reps: '1',
                  done: true,
                },
              ],
            },
          ],
        },
      })
      .expect(201);

    const res = await progressOf(auth, BENCH).expect(200);
    const body = res.body;

    expect(body).toMatchObject({
      exerciseId: BENCH,
      name: 'Supino reto (catálogo)',
      totalSessions: 4,
    });
    // 1 e 3. Pontos do mais antigo ao mais recente; um por sessão, com a maior carga dela.
    expect(
      body.points.map(
        (p: { sessionId: string; weight: number; reps: number }) => [
          p.sessionId,
          p.weight,
          p.reps,
        ],
      ),
    ).toEqual([
      [s1, 55, 10],
      [s2, 70, 6],
      [s3, 72.5, 5],
      [s4, 65, 10],
    ]);
    expect(body.points[0].startedAt).toBe('2026-09-03T22:00:00.000Z');

    // 2 e 3. Recorde = maior carga; no empate de 72,5 kg vale a série de 5 repetições.
    expect(body.record).toEqual({
      weight: 72.5,
      reps: 5,
      type: 'normal',
      sessionId: s3,
      title: 'Treino',
      startedAt: '2026-09-17T22:00:00.000Z',
    });

    // Histórico detalhado: mais recente primeiro, só as séries deste exercício.
    expect(
      body.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual([s4, s3, s2, s1]);
    const fromS2 = body.sessions[2];
    expect(fromS2).toMatchObject({
      setCount: 3,
      sets: [
        { type: 'normal', weight: 60, reps: 10 },
        { type: 'normal', weight: 70, reps: 6 },
        { type: 'normal', weight: 65, reps: 8 },
      ],
      best: { weight: 70, reps: 6 },
      origin: 'free',
    });
    expect(body.sessions[1].sets[0]).toEqual({
      type: 'warmup',
      weight: 20,
      reps: 15,
    });

    // 5. Exercícios diferentes não compartilham resultados.
    const squat = await progressOf(auth, SQUAT).expect(200);
    expect(squat.body.name).toBe('Agachamento'); // fora do catálogo: nome gravado no treino
    expect(squat.body.record).toMatchObject({ weight: 140, reps: 3 });
    expect(squat.body.points.map((p: { weight: number }) => p.weight)).toEqual([
      120, 140,
    ]);

    // 7. Cada usuário só vê os próprios dados.
    const theirs = await progressOf(other, BENCH).expect(200);
    expect(theirs.body).toMatchObject({
      totalSessions: 1,
      record: { weight: 500, reps: 1 },
    });
    expect(theirs.body.sessions).toHaveLength(1);
    // Um exercício só registrado por outra pessoa não existe para este usuário.
    await progressOf(other, SQUAT).expect(404);

    // 8. Consultar de novo (recarregar a página) devolve exatamente o mesmo resultado.
    const again = await progressOf(auth, BENCH).expect(200);
    expect(again.body).toEqual(body);

    // Janela menor: só as sessões mais recentes, mas o recorde continua sendo o de todo o histórico.
    const window = await progressOf(auth, BENCH, { limit: 1 }).expect(200);
    expect(
      window.body.sessions.map((s: { sessionId: string }) => s.sessionId),
    ).toEqual([s4]);
    expect(window.body.points).toHaveLength(1);
    expect(window.body.record.sessionId).toBe(s3);
    expect(window.body.totalSessions).toBe(4);
  });

  it('6. exercício do catálogo sem histórico: resposta vazia; sessões só de peso corporal não viram ponto', async () => {
    const auth = await signUp('prog-vazio');

    const empty = await progressOf(auth, EMPTY).expect(200);
    expect(empty.body).toEqual({
      exerciseId: EMPTY,
      name: 'Prancha (catálogo)',
      totalSessions: 0,
      limit: 60,
      record: null,
      points: [],
      sessions: [],
    });

    const id = await completed(auth, '2026-10-01T12:00:00.000Z', [
      { id: EMPTY, name: 'Prancha', sets: [[0, 60]] },
    ]);
    const bodyweight = await progressOf(auth, EMPTY).expect(200);
    expect(bodyweight.body).toMatchObject({
      totalSessions: 1,
      record: null,
      points: [],
      sessions: [{ sessionId: id, setCount: 1, best: null }],
    });

    await progressOf(auth, `Nao_Existe_${run}`).expect(404);
  });

  it('a maior carga histórica não muda a referência da próxima execução da rotina', async () => {
    const auth = await signUp('prog-rotina');
    const routine = await api()
      .post('/workouts')
      .set(auth)
      .send({
        title: 'Peito',
        exercises: [
          {
            exerciseId: BENCH,
            name: 'Supino',
            sets: [{ weight: 40, reps: 10 }],
          },
        ],
      })
      .expect(201);
    const workoutId = routine.body.id as string;

    async function perform(sets: Set[]) {
      const started = await api()
        .post('/sessions/start')
        .set(auth)
        .send({ workoutId, progress: emptyProgress('Peito') })
        .expect(201);
      await api()
        .post(`/sessions/${started.body.id}/finish`)
        .set(auth)
        .send({
          title: 'Peito',
          exercises: [
            { exerciseId: BENCH, name: 'Supino', sets: toSets(sets) },
          ],
        })
        .expect(200);
    }

    await perform([[90, 3]]); // pesado
    await perform([
      [60, 10],
      [60, 9],
    ]); // último treino, mais leve

    const reference = await api()
      .get(`/sessions/last-performance/${workoutId}`)
      .set(auth)
      .expect(200);
    expect(reference.body.exercises[0]).toMatchObject({
      source: 'last_session',
      sets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 9 },
      ],
    });

    const progress = await progressOf(auth, BENCH).expect(200);
    expect(progress.body.record).toMatchObject({ weight: 90, reps: 3 });
    expect(
      progress.body.points.map((p: { weight: number }) => p.weight),
    ).toEqual([90, 60]);
    // Nenhum registro original foi alterado pela consulta.
    const history = await api().get('/sessions').set(auth).expect(200);
    expect(history.body.pagination.total).toBe(2);
  });

  it('valida parâmetros e exige autenticação', async () => {
    const auth = await signUp('prog-validacao');
    await progressOf(auth, BENCH, { limit: 0 }).expect(400);
    await progressOf(auth, BENCH, { limit: 201 }).expect(400);
    await progressOf(auth, BENCH, { limit: 'x' }).expect(400);
    await progressOf(auth, 'x'.repeat(151)).expect(400);
    await api().get(`/sessions/exercises/${BENCH}/progress`).expect(401);
  });
});
