import {
  resolveLastPerformance,
  type CompletedSessionRows,
} from './last-performance';
import type { SetRow } from './session-view';

const set = (over: Partial<SetRow>): SetRow => ({
  exerciseId: null,
  exerciseName: 'X',
  exerciseOrder: 0,
  setOrder: 0,
  type: 'normal',
  weight: 0,
  reps: 0,
  ...over,
});

const session = (
  id: string,
  iso: string,
  sets: SetRow[],
): CompletedSessionRows => ({
  id,
  finishedAt: new Date(iso),
  sets,
});

const bench = {
  exerciseId: 'Bench_Press',
  name: 'Supino',
  sets: [{ weight: 20, reps: 10 }],
};

describe('resolveLastPerformance', () => {
  it('sem histórico: usa as séries planejadas da rotina', () => {
    const [result] = resolveLastPerformance([bench], []);
    expect(result).toMatchObject({ source: 'routine', sessionId: null });
    expect(result.sets).toEqual([{ type: 'normal', weight: 20, reps: 10 }]);
  });

  it('usa a execução concluída MAIS RECENTE, mesmo recebendo as sessões fora de ordem', () => {
    const old = session('s1', '2026-10-01T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        weight: 20,
        reps: 10,
      }),
    ]);
    const recent = session('s2', '2026-10-08T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        setOrder: 0,
        weight: 22,
        reps: 12,
      }),
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        setOrder: 1,
        weight: 22,
        reps: 12,
      }),
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        setOrder: 2,
        weight: 22,
        reps: 12,
      }),
    ]);
    const [result] = resolveLastPerformance([bench], [old, recent]);
    expect(result).toMatchObject({ source: 'last_session', sessionId: 's2' });
    expect(result.sets).toHaveLength(3);
    expect(result.sets.every((s) => s.weight === 22 && s.reps === 12)).toBe(
      true,
    );
    // O planejado continua disponível e intacto.
    expect(result.plannedSets).toEqual([{ weight: 20, reps: 10 }]);
  });

  it('associa pelo ID do catálogo, não pelo nome', () => {
    const recent = session('s1', '2026-10-08T10:00:00Z', [
      // Mesmo nome, outro exercício do catálogo: não pode ser usado.
      set({
        exerciseId: 'Incline_Bench',
        exerciseName: 'Supino',
        weight: 99,
        reps: 1,
      }),
    ]);
    const [result] = resolveLastPerformance([bench], [recent]);
    expect(result.source).toBe('routine');
  });

  it('exercício digitado (sem ID, inclusive de treinos antigos) é associado pelo nome', () => {
    const recent = session('s1', '2026-10-08T10:00:00Z', [
      set({ exerciseName: 'remada CAVALINHO', weight: 30, reps: 8 }),
    ]);
    const [result] = resolveLastPerformance(
      [{ name: 'Remada cavalinho', sets: [{ weight: 25, reps: 10 }] }],
      [recent],
    );
    expect(result).toMatchObject({
      source: 'last_session',
      sets: [{ type: 'normal', weight: 30, reps: 8 }],
    });
  });

  it('progressão por exercício: se o exercício não foi feito no último treino, busca a execução anterior dele', () => {
    const squat = {
      exerciseId: 'Squat',
      name: 'Agachamento',
      sets: [{ weight: 40, reps: 10 }],
    };
    const older = session('s1', '2026-10-01T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        weight: 21,
        reps: 10,
      }),
      set({
        exerciseId: 'Squat',
        exerciseName: 'Agachamento',
        exerciseOrder: 1,
        weight: 50,
        reps: 8,
      }),
    ]);
    const latest = session('s2', '2026-10-08T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        weight: 23,
        reps: 10,
      }),
    ]);
    const [b, s] = resolveLastPerformance([bench, squat], [latest, older]);
    expect(b).toMatchObject({ sessionId: 's2', sets: [{ weight: 23 }] });
    expect(s).toMatchObject({
      sessionId: 's1',
      sets: [{ weight: 50, reps: 8 }],
    });
  });

  it('exercício repetido na rotina: cada ocorrência recebe o seu bloco', () => {
    const recent = session('s1', '2026-10-08T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        exerciseOrder: 0,
        weight: 40,
        reps: 6,
      }),
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        exerciseOrder: 2,
        weight: 25,
        reps: 15,
      }),
    ]);
    const [first, second, third] = resolveLastPerformance(
      [bench, bench, bench],
      [recent],
    );
    expect(first.sets[0]).toMatchObject({ weight: 40, reps: 6 });
    expect(second.sets[0]).toMatchObject({ weight: 25, reps: 15 });
    expect(third.source).toBe('routine');
  });

  it('preserva o tipo das séries (aquecimento, drop, falha) e a ordem', () => {
    const recent = session('s1', '2026-10-08T10:00:00Z', [
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        setOrder: 1,
        type: 'normal',
        weight: 30,
        reps: 10,
      }),
      set({
        exerciseId: 'Bench_Press',
        exerciseName: 'Supino',
        setOrder: 0,
        type: 'warmup',
        weight: 10,
        reps: 15,
      }),
    ]);
    const [result] = resolveLastPerformance([bench], [recent]);
    expect(result.sets.map((s) => s.type)).toEqual(['warmup', 'normal']);
  });

  it('rotina sem exercícios ou com séries ausentes (dados antigos) não quebra', () => {
    expect(resolveLastPerformance([], [])).toEqual([]);
    const [result] = resolveLastPerformance(
      [{ name: 'Antigo', sets: null }],
      [],
    );
    expect(result).toMatchObject({
      source: 'routine',
      sets: [],
      plannedSets: [],
    });
  });
});
