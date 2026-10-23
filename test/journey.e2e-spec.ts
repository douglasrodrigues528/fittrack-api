/**
 * Jornada inicial, limite de 7 treinos planejados e sessões (livres e planejadas), de ponta a ponta,
 * contra um PostgreSQL DESCARTÁVEL. Nunca aponte para o banco de desenvolvimento ou produção.
 *
 *   E2E_DB_NAME=fittrack_journey_e2e npm run test:e2e -- journey
 *
 * Sem E2E_DB_NAME (ou com um nome que não pareça de teste) a suíte é ignorada.
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

const run = `${Date.now().toString(36)}`;

function progress(title: string, exercises: object[] = []) {
  return { title, notes: '', restSeconds: 90, exercises };
}

const set = (uid: string, weight: string, reps: string, done: boolean) => ({
  uid,
  type: 'normal',
  weight,
  reps,
  done,
});

describeE2E('Jornada inicial, limite de treinos e sessões (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());

  async function signUp(label: string) {
    const email = `${label}-${run}@exemplo.test`;
    await api()
      .post('/users')
      .send({ name: label, email, password: 'senha-forte-1' })
      .expect(201);
    const login = await api()
      .post('/auth/login')
      .send({ email, password: 'senha-forte-1' })
      .expect(201);
    const token = (login.body as { access_token: string }).access_token;
    return { email, auth: { Authorization: `Bearer ${token}` } };
  }

  const workoutBody = (title: string) => ({
    title,
    exercises: [
      {
        exerciseId: 'Bench_Press',
        name: 'Supino reto',
        sets: [{ weight: 40, reps: 10 }],
      },
    ],
  });

  beforeAll(async () => {
    // Variáveis do processo têm prioridade sobre o .env no ConfigModule.
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

  describe('primeiro acesso', () => {
    it('usuário novo vê as boas-vindas; a escolha fica gravada no servidor e vale no próximo login', async () => {
      const { email, auth } = await signUp('novo');

      const initial = await api().get('/onboarding').set(auth).expect(200);
      expect(initial.body).toMatchObject({
        onboardingCompleted: false,
        choice: null,
        plannedWorkouts: { used: 0, limit: 7, remaining: 7 },
        completedSessions: 0,
        activeSession: null,
      });

      await api()
        .post('/onboarding/complete')
        .set(auth)
        .send({ choice: 'free' })
        .expect(200);
      // A primeira escolha não é sobrescrita.
      const again = await api()
        .post('/onboarding/complete')
        .set(auth)
        .send({ choice: 'routine' })
        .expect(200);
      expect(again.body).toMatchObject({
        onboardingCompleted: true,
        choice: 'free',
      });

      // "Recarregar"/entrar de novo: novo token, mesmo estado (vem do banco, não do navegador).
      const login = await api()
        .post('/auth/login')
        .send({ email, password: 'senha-forte-1' })
        .expect(201);
      const relog = {
        Authorization: `Bearer ${(login.body as { access_token: string }).access_token}`,
      };
      const after = await api().get('/onboarding').set(relog).expect(200);
      expect(after.body).toMatchObject({
        onboardingCompleted: true,
        choice: 'free',
      });
    });

    it('rejeita escolha inválida', async () => {
      const { auth } = await signUp('escolha');
      await api()
        .post('/onboarding/complete')
        .set(auth)
        .send({ choice: 'outra' })
        .expect(400);
    });

    it('quem já tem treino não volta para as boas-vindas, mesmo sem ter registrado a escolha', async () => {
      const { auth } = await signUp('antigo');
      await api()
        .post('/workouts')
        .set(auth)
        .send(workoutBody('Treino A'))
        .expect(201);
      const state = await api().get('/onboarding').set(auth).expect(200);
      expect(state.body).toMatchObject({
        onboardingCompleted: true,
        choice: null,
      });
    });
  });

  describe('limite de 7 treinos planejados', () => {
    let owner: Awaited<ReturnType<typeof signUp>>;
    const ids: string[] = [];

    beforeAll(async () => {
      owner = await signUp('limite');
    });

    it('cria até 7 e recusa o 8º no backend com 409 e mensagem explicativa', async () => {
      for (let i = 1; i <= 7; i += 1) {
        const res = await api()
          .post('/workouts')
          .set(owner.auth)
          .send(workoutBody(`Treino ${i}`))
          .expect(201);
        ids.push((res.body as { id: string }).id);
      }
      const eighth = await api()
        .post('/workouts')
        .set(owner.auth)
        .send(workoutBody('Treino 8'))
        .expect(409);
      expect(eighth.body).toMatchObject({
        code: 'WORKOUT_LIMIT_REACHED',
        quota: { used: 7, remaining: 0 },
      });
      expect((eighth.body as { message: string }).message).toMatch(
        /exclua um/i,
      );

      const quota = await api()
        .get('/workouts/quota')
        .set(owner.auth)
        .expect(200);
      expect(quota.body).toEqual({ used: 7, limit: 7, remaining: 0 });
      const list = await api().get('/workouts').set(owner.auth).expect(200);
      expect(list.body).toHaveLength(7);
    });

    it('editar um dos 7 continua permitido e não consome vaga', async () => {
      const res = await api()
        .patch(`/workouts/${ids[0]}`)
        .set(owner.auth)
        .send({ title: 'Treino 1 editado', weekdays: [3, 1] })
        .expect(200);
      expect(res.body).toMatchObject({
        title: 'Treino 1 editado',
        weekdays: [1, 3],
      });
      const quota = await api()
        .get('/workouts/quota')
        .set(owner.auth)
        .expect(200);
      expect(quota.body).toMatchObject({ used: 7 });
    });

    it('excluir libera exatamente uma vaga', async () => {
      await api().delete(`/workouts/${ids.pop()}`).set(owner.auth).expect(200);
      expect(
        (await api().get('/workouts/quota').set(owner.auth)).body,
      ).toMatchObject({ used: 6, remaining: 1 });
      await api()
        .post('/workouts')
        .set(owner.auth)
        .send(workoutBody('Repõe a vaga'))
        .expect(201);
      await api()
        .post('/workouts')
        .set(owner.auth)
        .send(workoutBody('Passa do limite'))
        .expect(409);
    });

    it('requisições simultâneas não passam de 7', async () => {
      const list = await api().get('/workouts').set(owner.auth).expect(200);
      const [first, second] = list.body as { id: string }[];
      await api().delete(`/workouts/${first.id}`).set(owner.auth).expect(200);
      await api().delete(`/workouts/${second.id}`).set(owner.auth).expect(200);

      // 2 vagas livres, 8 tentativas ao mesmo tempo.
      const attempts = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          api()
            .post('/workouts')
            .set(owner.auth)
            .send(workoutBody(`Paralelo ${i}`)),
        ),
      );
      const statuses = attempts.map((res) => res.status).sort();
      expect(statuses.filter((status) => status === 201)).toHaveLength(2);
      expect(statuses.filter((status) => status === 409)).toHaveLength(6);

      const [{ count }] = await dataSource.query(
        'SELECT count(*)::int AS count FROM workouts w JOIN users u ON u.id = w."userId" WHERE u.email = $1',
        [owner.email],
      );
      expect(count).toBe(7);
    });

    it('outro usuário tem o próprio limite e não acessa, edita nem exclui treinos alheios', async () => {
      const other = await signUp('outro');
      expect((await api().get('/workouts/quota').set(other.auth)).body).toEqual(
        { used: 0, limit: 7, remaining: 7 },
      );
      await api()
        .post('/workouts')
        .set(other.auth)
        .send(workoutBody('Meu treino'))
        .expect(201);

      const foreignId = ids[0];
      await api().get(`/workouts/${foreignId}`).set(other.auth).expect(404);
      await api()
        .patch(`/workouts/${foreignId}`)
        .set(other.auth)
        .send({ title: 'invadido' })
        .expect(404);
      await api().delete(`/workouts/${foreignId}`).set(other.auth).expect(404);
      // userId enviado pelo cliente é rejeitado.
      await api()
        .post('/workouts')
        .set(other.auth)
        .send({
          ...workoutBody('X'),
          userId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
      expect(
        (await api().get(`/workouts/${foreignId}`).set(owner.auth)).body,
      ).toMatchObject({
        title: 'Treino 1 editado',
      });
    });

    it('sem token, nada é acessível', async () => {
      await api().get('/workouts').expect(401);
      await api().get('/onboarding').expect(401);
      await api().get('/sessions/active').expect(401);
    });
  });

  describe('treino livre e sessões', () => {
    let user: Awaited<ReturnType<typeof signUp>>;
    let sessionId = '';

    beforeAll(async () => {
      user = await signUp('livre');
    });

    it('inicia um treino livre sem criar treino planejado nem consumir vaga', async () => {
      const res = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({ progress: progress('Treino livre') })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'in_progress',
        origin: 'free',
        workoutId: null,
      });
      sessionId = (res.body as { id: string }).id;

      expect(
        (await api().get('/workouts/quota').set(user.auth)).body,
      ).toMatchObject({ used: 0 });
      const state = await api().get('/onboarding').set(user.auth).expect(200);
      expect(state.body).toMatchObject({
        onboardingCompleted: true,
        activeSession: { id: sessionId, origin: 'free' },
      });
    });

    it('não abre uma segunda sessão em andamento (409 com a sessão a retomar)', async () => {
      const res = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({ progress: progress('Outro') })
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'SESSION_IN_PROGRESS',
        activeSession: { id: sessionId },
      });
    });

    it('grava vários exercícios e séries; remover série e exercício individualmente é persistido', async () => {
      const full = progress('Treino livre', [
        {
          uid: 'e1',
          exerciseId: 'Barbell_Squat',
          name: 'Agachamento',
          sets: [
            set('s1', '60', '10', true),
            set('s2', '70', '8', true),
            set('s3', '80', '6', false),
          ],
        },
        {
          uid: 'e2',
          exerciseId: 'Bench_Press',
          name: 'Supino',
          sets: [set('s4', '40', '12', true)],
        },
        {
          uid: 'e3',
          name: 'Exercício digitado',
          sets: [set('s5', '0', '15', true)],
        },
        // Mesmo exercício do catálogo de novo, de propósito (outro bloco).
        {
          uid: 'e4',
          exerciseId: 'Bench_Press',
          name: 'Supino',
          sets: [set('s6', '35', '15', true)],
        },
      ]);
      await api()
        .put(`/sessions/${sessionId}/progress`)
        .set(user.auth)
        .send({ progress: full })
        .expect(200);

      // "Recarregar a página": tudo volta do servidor.
      let active = await api()
        .get('/sessions/active')
        .set(user.auth)
        .expect(200);
      expect(active.body.session.progress.exercises).toHaveLength(4);
      expect(active.body.session.progress.exercises[0].sets).toHaveLength(3);

      // Remove a série s2 e o exercício e3.
      const trimmed = {
        ...full,
        exercises: full.exercises
          .filter((exercise) => (exercise as { uid: string }).uid !== 'e3')
          .map((exercise) => {
            const typed = exercise as { uid: string; sets: { uid: string }[] };
            return typed.uid === 'e1'
              ? { ...typed, sets: typed.sets.filter((s) => s.uid !== 's2') }
              : typed;
          }),
      };
      await api()
        .put(`/sessions/${sessionId}/progress`)
        .set(user.auth)
        .send({ progress: trimmed })
        .expect(200);
      active = await api().get('/sessions/active').set(user.auth).expect(200);
      const exercises = active.body.session.progress.exercises as {
        uid: string;
        sets: { uid: string }[];
      }[];
      expect(exercises.map((exercise) => exercise.uid)).toEqual([
        'e1',
        'e2',
        'e4',
      ]);
      expect(exercises[0].sets.map((s) => s.uid)).toEqual(['s1', 's3']);
    });

    it('rejeita progresso com campos desconhecidos e protege a sessão de outros usuários', async () => {
      await api()
        .put(`/sessions/${sessionId}/progress`)
        .set(user.auth)
        .send({ progress: { ...progress('x'), userId: 'outro' } })
        .expect(400);

      const intruder = await signUp('intruso');
      await api()
        .put(`/sessions/${sessionId}/progress`)
        .set(intruder.auth)
        .send({ progress: progress('x') })
        .expect(404);
      await api()
        .post(`/sessions/${sessionId}/finish`)
        .set(intruder.auth)
        .send({
          title: 'x',
          exercises: [
            { name: 'x', sets: [{ type: 'normal', weight: 1, reps: 1 }] },
          ],
        })
        .expect(404);
      await api()
        .post(`/sessions/${sessionId}/cancel`)
        .set(intruder.auth)
        .expect(404);
      await api().get(`/sessions/${sessionId}`).set(intruder.auth).expect(404);
      expect(
        (await api().get('/sessions/active').set(intruder.auth)).body,
      ).toEqual({ session: null });
    });

    it('finaliza (idempotente) e a sessão aparece no histórico com apenas as séries realizadas', async () => {
      const body = {
        title: 'Treino livre de quinta',
        notes: 'Bom treino',
        exercises: [
          {
            exerciseId: 'Barbell_Squat',
            name: 'Agachamento',
            sets: [{ type: 'normal', weight: 60, reps: 10 }],
          },
          {
            exerciseId: 'Bench_Press',
            name: 'Supino',
            sets: [{ type: 'normal', weight: 40, reps: 12 }],
          },
          {
            exerciseId: 'Bench_Press',
            name: 'Supino',
            sets: [{ type: 'normal', weight: 35, reps: 15 }],
          },
        ],
      };
      const first = await api()
        .post(`/sessions/${sessionId}/finish`)
        .set(user.auth)
        .send(body)
        .expect(200);
      expect(first.body).toMatchObject({
        id: sessionId,
        status: 'completed',
        origin: 'free',
        totalSets: 3,
      });

      // A resposta "se perdeu" e o app tentou de novo: não duplica.
      const retry = await api()
        .post(`/sessions/${sessionId}/finish`)
        .set(user.auth)
        .send(body)
        .expect(200);
      expect(retry.body).toMatchObject({ id: sessionId, totalSets: 3 });

      expect((await api().get('/sessions/active').set(user.auth)).body).toEqual(
        { session: null },
      );
      const history = await api().get('/sessions').set(user.auth).expect(200);
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0]).toMatchObject({
        title: 'Treino livre de quinta',
        origin: 'free',
        totalSets: 3,
      });
      expect(history.body.data[0].exercises).toHaveLength(3);

      await api()
        .put(`/sessions/${sessionId}/progress`)
        .set(user.auth)
        .send({ progress: progress('x') })
        .expect(409);
      await api()
        .post(`/sessions/${sessionId}/cancel`)
        .set(user.auth)
        .expect(409);
    });

    it('treinar de novo cria outra sessão e preserva a anterior; iniciar um planejado não cria modelo', async () => {
      const routine = await api()
        .post('/workouts')
        .set(user.auth)
        .send(workoutBody('Peito'))
        .expect(201);
      const routineId = (routine.body as { id: string }).id;

      for (let round = 1; round <= 2; round += 1) {
        const started = await api()
          .post('/sessions/start')
          .set(user.auth)
          .send({ workoutId: routineId, progress: progress('') })
          .expect(201);
        expect(started.body).toMatchObject({
          origin: 'planned',
          workoutId: routineId,
          title: 'Peito',
        });
        await api()
          .post(`/sessions/${(started.body as { id: string }).id}/finish`)
          .set(user.auth)
          .send({
            title: 'Peito',
            exercises: [
              {
                name: 'Supino',
                sets: [{ type: 'normal', weight: 40 + round, reps: 10 }],
              },
            ],
          })
          .expect(200);
      }

      expect(
        (await api().get('/workouts/quota').set(user.auth)).body,
      ).toMatchObject({ used: 1 });
      const history = await api().get('/sessions').set(user.auth).expect(200);
      expect(history.body.data).toHaveLength(3);
      expect(
        history.body.data.map((s: { origin: string }) => s.origin),
      ).toEqual(['planned', 'planned', 'free']);

      // Cargas anteriores: a mais recente concluída.
      const previous = await api()
        .post('/sessions/previous')
        .set(user.auth)
        .send({ exercises: [{ name: 'Supino' }] })
        .expect(200);
      expect(previous.body[0].sets[0]).toMatchObject({ weight: 42, reps: 10 });

      // Editar e depois excluir o modelo não apaga o histórico.
      await api()
        .patch(`/workouts/${routineId}`)
        .set(user.auth)
        .send({ title: 'Peito v2', exercises: [] })
        .expect(200);
      await api().delete(`/workouts/${routineId}`).set(user.auth).expect(200);
      const afterDelete = await api()
        .get('/sessions')
        .set(user.auth)
        .expect(200);
      expect(afterDelete.body.data).toHaveLength(3);
      expect(afterDelete.body.data[0]).toMatchObject({
        title: 'Peito',
        origin: 'planned',
        workoutId: null,
      });
    });

    it('não inicia sessão a partir de treino de outro usuário', async () => {
      const other = await signUp('alheio');
      const foreign = await api()
        .post('/workouts')
        .set(other.auth)
        .send(workoutBody('Do outro'))
        .expect(201);
      await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({
          workoutId: (foreign.body as { id: string }).id,
          progress: progress(''),
        })
        .expect(400);
    });

    it('descartar tira a sessão de andamento sem levá-la ao histórico', async () => {
      const started = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({ progress: progress('Descartável') })
        .expect(201);
      const id = (started.body as { id: string }).id;
      await api().post(`/sessions/${id}/cancel`).set(user.auth).expect(200);
      await api().post(`/sessions/${id}/cancel`).set(user.auth).expect(200); // idempotente
      expect((await api().get('/sessions/active').set(user.auth)).body).toEqual(
        { session: null },
      );
      expect(
        (await api().get('/sessions').set(user.auth)).body.data,
      ).toHaveLength(3);
      await api()
        .post(`/sessions/${id}/finish`)
        .set(user.auth)
        .send({
          title: 'x',
          exercises: [
            { name: 'x', sets: [{ type: 'normal', weight: 1, reps: 1 }] },
          ],
        })
        .expect(409);
    });

    it('duas tentativas simultâneas de iniciar abrem só uma sessão', async () => {
      const racer = await signUp('corrida');
      const attempts = await Promise.all(
        Array.from({ length: 4 }, () =>
          api()
            .post('/sessions/start')
            .set(racer.auth)
            .send({ progress: progress('Livre') }),
        ),
      );
      const statuses = attempts.map((res) => res.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(3);
    });

    it('o registro direto de sessão finalizada (POST /sessions) continua funcionando', async () => {
      const res = await api()
        .post('/sessions')
        .set(user.auth)
        .send({
          title: 'Sem conexão',
          startedAt: '2026-10-20T10:00:00.000Z',
          finishedAt: '2026-10-20T11:00:00.000Z',
          exercises: [
            {
              name: 'Remada',
              sets: [{ type: 'normal', weight: 30, reps: 10 }],
            },
          ],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'completed',
        origin: 'free',
        durationSeconds: 3600,
      });
    });
  });

  describe('compatibilidade com dados antigos', () => {
    it('treino antigo sem exerciseId e sessão antiga sem status/origem continuam carregando e editáveis', async () => {
      const { email, auth } = await signUp('legado');
      const [{ id: userId }] = await dataSource.query(
        'SELECT id FROM users WHERE email = $1',
        [email],
      );

      // Inserção crua no formato antigo (colunas novas ficam com o padrão do banco).
      const [{ id: workoutId }] = await dataSource.query(
        `INSERT INTO workouts (title, exercises, "userId")
         VALUES ('Treino antigo', '[{"name":"Supino digitado","sets":[{"weight":40,"reps":10}]}]', $1) RETURNING id`,
        [userId],
      );
      const [{ id: legacySession }] = await dataSource.query(
        `INSERT INTO workout_sessions ("userId", "workoutId", title, "startedAt", "finishedAt", "durationSeconds")
         VALUES ($1, $2, 'Sessão antiga', now() - interval '1 hour', now(), 3600) RETURNING id`,
        [userId, workoutId],
      );
      await dataSource.query(
        `INSERT INTO session_sets ("sessionId", "exerciseName", "exerciseOrder", "setOrder", weight, reps)
         VALUES ($1, 'Supino digitado', 0, 0, 40, 10)`,
        [legacySession],
      );

      const list = await api().get('/workouts').set(auth).expect(200);
      expect(list.body[0]).toMatchObject({
        title: 'Treino antigo',
        weekdays: [],
      });
      expect(list.body[0].exercises[0]).toEqual({
        name: 'Supino digitado',
        sets: [{ weight: 40, reps: 10 }],
      });

      await api()
        .patch(`/workouts/${workoutId}`)
        .set(auth)
        .send({ description: 'editado' })
        .expect(200);

      const history = await api().get('/sessions').set(auth).expect(200);
      expect(history.body.data[0]).toMatchObject({
        title: 'Sessão antiga',
        status: 'completed',
        origin: 'planned',
      });

      await api().delete(`/workouts/${workoutId}`).set(auth).expect(200);
      expect((await api().get('/sessions').set(auth)).body.data).toHaveLength(
        1,
      );
    });
  });
  describe('progressão de cargas: a próxima execução usa o último treino concluído da rotina', () => {
    type Perf = {
      exerciseId: string | null;
      name: string;
      source: 'last_session' | 'routine';
      plannedSets: { weight: number; reps: number }[];
      sets: { type: string; weight: number; reps: number }[];
    };

    const benchRoutine = {
      title: 'Peito — progressão',
      exercises: [
        {
          exerciseId: 'Bench_Press',
          name: 'Supino reto',
          sets: [
            { weight: 20, reps: 10 },
            { weight: 20, reps: 10 },
            { weight: 20, reps: 10 },
          ],
        },
      ],
    };

    const shape = (perf: Perf) => perf.sets.map((s) => `${s.weight}x${s.reps}`);

    async function reference(auth: Record<string, string>, workoutId: string) {
      const res = await api()
        .get(`/sessions/last-performance/${workoutId}`)
        .set(auth)
        .expect(200);
      return res.body.exercises as Perf[];
    }

    /** Executa a rotina como o app faz: inicia a partir da referência e conclui com o que foi feito. */
    async function perform(
      auth: Record<string, string>,
      workoutId: string,
      done: Record<string, [number, number][]>,
      finishedAt?: string,
    ) {
      const perf = await reference(auth, workoutId);
      const started = await api()
        .post('/sessions/start')
        .set(auth)
        .send({
          workoutId,
          progress: progress(
            '',
            perf.map((exercise, i) => ({
              uid: `e${i}`,
              ...(exercise.exerciseId
                ? { exerciseId: exercise.exerciseId }
                : {}),
              name: exercise.name,
              sets: exercise.sets.map((s, j) =>
                set(`s${i}-${j}`, String(s.weight), String(s.reps), false),
              ),
            })),
          ),
        })
        .expect(201);
      await api()
        .post(`/sessions/${started.body.id}/finish`)
        .set(auth)
        .send({
          title: 'Peito',
          ...(finishedAt ? { finishedAt } : {}),
          exercises: perf
            .filter((exercise) => done[exercise.name])
            .map((exercise) => ({
              ...(exercise.exerciseId
                ? { exerciseId: exercise.exerciseId }
                : {}),
              name: exercise.name,
              sets: done[exercise.name].map(([weight, reps]) => ({
                type: 'normal',
                weight,
                reps,
              })),
            })),
        })
        .expect(200);
      return started.body.id as string;
    }

    it('1ª execução usa a rotina; depois, sempre o último treino concluído; histórico e rotina intactos', async () => {
      const user = await signUp('progressao');
      const routine = await api()
        .post('/workouts')
        .set(user.auth)
        .send(benchRoutine)
        .expect(201);
      const routineId = routine.body.id as string;

      // 1) Nunca executada: valores da rotina (3 × 10 com 20 kg).
      let [bench] = await reference(user.auth, routineId);
      expect(bench.source).toBe('routine');
      expect(shape(bench)).toEqual(['20x10', '20x10', '20x10']);

      // 2) Executa e conclui como planejado.
      await perform(user.auth, routineId, {
        'Supino reto': [
          [20, 10],
          [20, 10],
          [20, 10],
        ],
      });
      [bench] = await reference(user.auth, routineId);
      expect(bench.source).toBe('last_session');
      expect(shape(bench)).toEqual(['20x10', '20x10', '20x10']);

      // 3–5) Sobe para 22 kg × 12 e conclui: a próxima execução carrega 22 kg, 3 séries, 12 reps.
      await perform(user.auth, routineId, {
        'Supino reto': [
          [22, 12],
          [22, 12],
          [22, 12],
        ],
      });
      [bench] = await reference(user.auth, routineId);
      expect(shape(bench)).toEqual(['22x12', '22x12', '22x12']);

      // Persistência: sair e entrar de novo (novo token) devolve o mesmo, direto do banco.
      const login = await api()
        .post('/auth/login')
        .send({ email: user.email, password: 'senha-forte-1' })
        .expect(201);
      const relog = { Authorization: `Bearer ${login.body.access_token}` };
      [bench] = await reference(relog, routineId);
      expect(shape(bench)).toEqual(['22x12', '22x12', '22x12']);

      // 6) Muda de novo (inclusive o número de séries) e a seguinte carrega os novos valores.
      await perform(relog, routineId, {
        'Supino reto': [
          [24, 8],
          [24, 8],
          [24, 8],
          [24, 6],
        ],
      });
      [bench] = await reference(relog, routineId);
      expect(shape(bench)).toEqual(['24x8', '24x8', '24x8', '24x6']);

      // 7) Histórico: cada execução continua registrada com os seus valores originais.
      const history = await api().get('/sessions').set(relog).expect(200);
      const rows = (
        history.body.data as {
          workoutId: string;
          exercises: { sets: { weight: number; reps: number }[] }[];
        }[]
      )
        .filter((s) => s.workoutId === routineId)
        .map((s) => s.exercises[0].sets.map((x) => `${x.weight}x${x.reps}`));
      expect(rows).toEqual([
        ['24x8', '24x8', '24x8', '24x6'],
        ['22x12', '22x12', '22x12'],
        ['20x10', '20x10', '20x10'],
      ]);

      // A rotina planejada NÃO foi alterada pelos treinos.
      const stored = await api()
        .get(`/workouts/${routineId}`)
        .set(relog)
        .expect(200);
      expect(stored.body.exercises[0].sets).toEqual(
        benchRoutine.exercises[0].sets,
      );
      expect(bench.plannedSets).toEqual(benchRoutine.exercises[0].sets);
    });

    it('não vaza para outra rotina nem para outro usuário; treino livre e sessões não concluídas não contam', async () => {
      const user = await signUp('isolamento');
      const a = (
        await api()
          .post('/workouts')
          .set(user.auth)
          .send(benchRoutine)
          .expect(201)
      ).body.id as string;
      const b = (
        await api()
          .post('/workouts')
          .set(user.auth)
          .send({ ...benchRoutine, title: 'Outra rotina' })
          .expect(201)
      ).body.id as string;

      await perform(user.auth, a, {
        'Supino reto': [
          [30, 5],
          [30, 5],
          [30, 5],
        ],
      });

      // 8) Outra rotina do mesmo usuário, com o mesmo exercício: continua com os próprios valores.
      expect(shape((await reference(user.auth, b))[0])).toEqual([
        '20x10',
        '20x10',
        '20x10',
      ]);

      // Outro usuário: não acessa a rotina alheia e a dele não recebe nada.
      const other = await signUp('isolamento-outro');
      await api()
        .get(`/sessions/last-performance/${a}`)
        .set(other.auth)
        .expect(404);
      const mine = (
        await api()
          .post('/workouts')
          .set(other.auth)
          .send(benchRoutine)
          .expect(201)
      ).body.id as string;
      expect((await reference(other.auth, mine))[0].source).toBe('routine');

      // Treino livre com o mesmo exercício não muda a referência da rotina.
      const free = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({ progress: progress('Livre') })
        .expect(201);
      await api()
        .post(`/sessions/${free.body.id}/finish`)
        .set(user.auth)
        .send({
          title: 'Livre',
          exercises: [
            {
              exerciseId: 'Bench_Press',
              name: 'Supino reto',
              sets: [{ type: 'normal', weight: 100, reps: 1 }],
            },
          ],
        })
        .expect(200);

      // Execução descartada e execução em andamento também não contam.
      const cancelled = await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({ workoutId: a, progress: progress('') })
        .expect(201);
      await api()
        .post(`/sessions/${cancelled.body.id}/cancel`)
        .set(user.auth)
        .expect(200);
      await api()
        .post('/sessions/start')
        .set(user.auth)
        .send({
          workoutId: a,
          progress: progress('', [
            {
              uid: 'x',
              exerciseId: 'Bench_Press',
              name: 'Supino reto',
              sets: [set('y', '80', '2', true)],
            },
          ]),
        })
        .expect(201);

      expect(shape((await reference(user.auth, a))[0])).toEqual([
        '30x5',
        '30x5',
        '30x5',
      ]);
    });

    it('dashboard (todas as rotinas) devolve exatamente a mesma referência do iniciar treino', async () => {
      const user = await signUp('dashboard');
      const a = (
        await api()
          .post('/workouts')
          .set(user.auth)
          .send(benchRoutine)
          .expect(201)
      ).body.id as string;
      const b = (
        await api()
          .post('/workouts')
          .set(user.auth)
          .send({ ...benchRoutine, title: 'Sem histórico' })
          .expect(201)
      ).body.id as string;

      const dashboard = async (auth: Record<string, string>) => {
        const res = await api()
          .get('/sessions/last-performance')
          .set(auth)
          .expect(200);
        return new Map(
          (res.body.data as { workoutId: string; exercises: Perf[] }[]).map(
            (r) => [r.workoutId, r.exercises],
          ),
        );
      };

      await perform(user.auth, a, {
        'Supino reto': [
          [22, 12],
          [22, 12],
          [22, 12],
        ],
      });

      let all = await dashboard(user.auth);
      expect(shape(all.get(a)![0])).toEqual(['22x12', '22x12', '22x12']);
      expect(all.get(b)![0].source).toBe('routine');
      expect(shape(all.get(b)![0])).toEqual(['20x10', '20x10', '20x10']);
      // Mesma fonte e mesma regra: idêntico ao endpoint usado ao iniciar o treino.
      for (const id of [a, b])
        expect(all.get(id)).toEqual(await reference(user.auth, id));

      // Concluir outro treino atualiza o dashboard; novo login lê o mesmo do banco.
      await perform(user.auth, a, {
        'Supino reto': [
          [24, 10],
          [24, 10],
          [24, 10],
        ],
      });
      const login = await api()
        .post('/auth/login')
        .send({ email: user.email, password: 'senha-forte-1' })
        .expect(201);
      all = await dashboard({
        Authorization: `Bearer ${login.body.access_token}`,
      });
      expect(shape(all.get(a)![0])).toEqual(['24x10', '24x10', '24x10']);

      // Outro usuário só vê as próprias rotinas.
      const other = await signUp('dashboard-outro');
      expect((await dashboard(other.auth)).size).toBe(0);
    });

    it('9) exercício novo na rotina usa os valores planejados; os demais seguem a progressão', async () => {
      const user = await signUp('exercicio-novo');
      const routineId = (
        await api()
          .post('/workouts')
          .set(user.auth)
          .send(benchRoutine)
          .expect(201)
      ).body.id as string;
      await perform(user.auth, routineId, {
        'Supino reto': [
          [25, 10],
          [25, 10],
          [25, 10],
        ],
      });

      await api()
        .patch(`/workouts/${routineId}`)
        .set(user.auth)
        .send({
          exercises: [
            ...benchRoutine.exercises,
            {
              exerciseId: 'Barbell_Squat',
              name: 'Agachamento',
              sets: [{ weight: 40, reps: 12 }],
            },
          ],
        })
        .expect(200);

      let [bench, squat] = await reference(user.auth, routineId);
      expect(shape(bench)).toEqual(['25x10', '25x10', '25x10']);
      expect(squat).toMatchObject({ source: 'routine' });
      expect(shape(squat)).toEqual(['40x12']);

      // Treino seguinte sem fazer o supino: o supino mantém a referência anterior (por exercício).
      await perform(user.auth, routineId, { Agachamento: [[45, 10]] });
      [bench, squat] = await reference(user.auth, routineId);
      expect(shape(bench)).toEqual(['25x10', '25x10', '25x10']);
      expect(shape(squat)).toEqual(['45x10']);
    });
  });
});
