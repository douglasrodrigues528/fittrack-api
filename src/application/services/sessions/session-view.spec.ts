import { computeVolume, groupExercises, resolveOrigin, toSessionView, type SetRow } from './session-view';

const row = (over: Partial<SetRow>): SetRow => ({
  exerciseId: null,
  exerciseName: 'X',
  exerciseOrder: 0,
  setOrder: 0,
  type: 'normal',
  weight: 10,
  reps: 10,
  ...over,
});

describe('session-view', () => {
  it('agrupa séries por exercício respeitando a ordem, mesmo vindas embaralhadas', () => {
    const exercises = groupExercises([
      row({ exerciseName: 'B', exerciseOrder: 1, setOrder: 0, weight: 5 }),
      row({ exerciseName: 'A', exerciseOrder: 0, setOrder: 1, weight: 22 }),
      row({ exerciseName: 'A', exerciseOrder: 0, setOrder: 0, weight: 20 }),
    ]);
    expect(exercises.map((e) => e.name)).toEqual(['A', 'B']);
    expect(exercises[0].sets.map((s) => s.weight)).toEqual([20, 22]);
  });

  it('separa o mesmo exercício repetido em blocos diferentes', () => {
    const exercises = groupExercises([
      row({ exerciseName: 'A', exerciseOrder: 0 }),
      row({ exerciseName: 'A', exerciseOrder: 1 }),
    ]);
    expect(exercises).toHaveLength(2);
  });

  it('volume ignora aquecimento', () => {
    expect(
      computeVolume([
        { type: 'warmup', weight: 20, reps: 10 },
        { type: 'normal', weight: 40, reps: 10 },
        { type: 'failure', weight: 40, reps: 5 },
      ]),
    ).toBe(600);
  });

  it('monta a visão completa da sessão', () => {
    const view = toSessionView({
      id: 's1',
      workoutId: null,
      title: 'T',
      startedAt: new Date('2026-01-01T10:00:00Z'),
      finishedAt: new Date('2026-01-01T11:00:00Z'),
      durationSeconds: 3600,
      notes: null,
      sets: [row({ weight: 10, reps: 10 }), row({ setOrder: 1, weight: 10, reps: 8 })],
    });
    expect(view.totalSets).toBe(2);
    expect(view.totalVolume).toBe(180);
    expect(view.exercises).toHaveLength(1);
    expect(view.status).toBe('completed');
    expect(view.origin).toBe('free');
  });

  it('deduz a origem de sessões antigas e respeita a origem gravada', () => {
    expect(resolveOrigin({ origin: null, workoutId: 'w1' })).toBe('planned');
    expect(resolveOrigin({ origin: null, workoutId: null })).toBe('free');
    // Rotina excluída depois (workoutId vira NULL): a origem gravada continua valendo.
    expect(resolveOrigin({ origin: 'planned', workoutId: null })).toBe('planned');
  });
});
