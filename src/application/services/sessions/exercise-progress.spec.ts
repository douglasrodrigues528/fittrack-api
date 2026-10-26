import {
  bestSet,
  buildExerciseProgress,
  isValidLoad,
  type ProgressSessionRow,
  type ProgressSetRow,
} from './exercise-progress';

const session = (id: string, iso: string, title = id): ProgressSessionRow => ({
  id,
  workoutId: null,
  origin: 'free',
  title,
  startedAt: new Date(iso),
  finishedAt: new Date(Date.parse(iso) + 3_600_000),
});

const set = (
  sessionId: string,
  setOrder: number,
  weight: number,
  reps: number,
  over: Partial<ProgressSetRow> = {},
): ProgressSetRow => ({
  sessionId,
  exerciseOrder: 0,
  setOrder,
  type: 'normal',
  weight,
  reps,
  ...over,
});

describe('isValidLoad', () => {
  it('exige carga e repetições positivas', () => {
    expect(isValidLoad({ weight: 20, reps: 8 })).toBe(true);
    expect(isValidLoad({ weight: 0, reps: 12 })).toBe(false);
    expect(isValidLoad({ weight: 40, reps: 0 })).toBe(false);
    expect(isValidLoad({ weight: Number.NaN, reps: 5 })).toBe(false);
  });
});

describe('bestSet', () => {
  it('escolhe a maior carga e devolve as repetições DAQUELA série', () => {
    const sets = [
      { weight: 60, reps: 12 },
      { weight: 80, reps: 5 },
      { weight: 70, reps: 8 },
    ];
    expect(bestSet(sets)).toBe(sets[1]);
  });

  it('empate de carga: mais repetições; persistindo, a primeira', () => {
    const a = { weight: 80, reps: 5 };
    const b = { weight: 80, reps: 6 };
    const c = { weight: 80, reps: 6 };
    expect(bestSet([a, b, c])).toBe(b);
  });

  it('sem carga válida: null', () => {
    expect(bestSet([{ weight: 0, reps: 15 }])).toBeNull();
    expect(bestSet([])).toBeNull();
  });
});

describe('buildExerciseProgress', () => {
  it('pontos em ordem cronológica pelo início, mesmo recebendo fora de ordem', () => {
    const sessions = [
      session('s2', '2026-10-08T10:00:00Z'),
      session('s3', '2026-10-15T10:00:00Z'),
      session('s1', '2026-10-01T10:00:00Z'),
    ];
    const sets = [
      set('s3', 0, 50, 8),
      set('s1', 0, 40, 10),
      set('s2', 0, 45, 10),
      set('s2', 1, 47.5, 6),
    ];
    const result = buildExerciseProgress(sessions, sets);

    expect(result.points.map((p) => [p.sessionId, p.weight, p.reps])).toEqual([
      ['s1', 40, 10],
      ['s2', 47.5, 6],
      ['s3', 50, 8],
    ]);
    // Histórico: mais recente primeiro (mesma ordem do histórico geral).
    expect(result.sessions.map((s) => s.sessionId)).toEqual(['s3', 's2', 's1']);
  });

  it('histórico traz todas as séries do exercício na ordem feita, com a contagem', () => {
    const result = buildExerciseProgress(
      [session('s1', '2026-10-01T10:00:00Z')],
      [
        set('s1', 1, 60, 8),
        set('s1', 0, 20, 15, { type: 'warmup' }),
        // O mesmo exercício repetido mais adiante no treino (outro bloco).
        set('s1', 0, 50, 12, { exerciseOrder: 3 }),
      ],
    );
    expect(result.sessions[0]).toMatchObject({
      setCount: 3,
      sets: [
        { type: 'warmup', weight: 20, reps: 15 },
        { type: 'normal', weight: 60, reps: 8 },
        { type: 'normal', weight: 50, reps: 12 },
      ],
      best: { weight: 60, reps: 8 },
    });
  });

  it('sessão só com peso corporal aparece no histórico, mas não vira ponto', () => {
    const result = buildExerciseProgress(
      [
        session('s1', '2026-10-01T10:00:00Z'),
        session('s2', '2026-10-02T10:00:00Z'),
      ],
      [set('s1', 0, 0, 15), set('s2', 0, 10, 12)],
    );
    expect(result.sessions.map((s) => [s.sessionId, s.best])).toEqual([
      ['s2', { type: 'normal', weight: 10, reps: 12 }],
      ['s1', null],
    ]);
    expect(result.points.map((p) => p.sessionId)).toEqual(['s2']);
  });

  it('carga e repetições do ponto vêm da MESMA série (nunca 22 kg com as 12 reps de outra)', () => {
    const result = buildExerciseProgress(
      [
        session('s1', '2026-10-01T10:00:00Z'),
        session('s2', '2026-10-08T10:00:00Z'),
      ],
      [
        set('s1', 0, 20, 12),
        set('s2', 0, 20, 12),
        set('s2', 1, 22, 10),
        set('s2', 2, 21, 11),
      ],
    );
    expect(result.points.map((p) => [p.weight, p.reps])).toEqual([
      [20, 12],
      [22, 10],
    ]);
    // O histórico mantém as três séries da 2ª sessão, com as cargas diferentes.
    expect(result.sessions[0].sets.map((s) => [s.weight, s.reps])).toEqual([
      [20, 12],
      [22, 10],
      [21, 11],
    ]);
  });

  it('sem sessões: tudo vazio', () => {
    expect(buildExerciseProgress([], [])).toEqual({ sessions: [], points: [] });
  });
});
