import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  applySuggestion,
  incrementFor,
  performanceByExercise,
  revertSuggestion,
  suggestLoad,
  suggestionState,
  weightRangeLabel,
  type LoadSuggestion,
} from '../load-suggestion';
import { startSession, type ExercisePerformance, type LiveSession } from '../session';

type Done = [weight: number, reps: number, type?: string];

const perf = (
  planned: [number, number][],
  done: Done[] | null,
  over: Partial<ExercisePerformance> = {},
): ExercisePerformance => ({
  exerciseId: 'Bench_Press',
  name: 'Supino',
  plannedSets: planned.map(([weight, reps]) => ({ weight, reps })),
  source: done ? 'last_session' : 'routine',
  performedAt: done ? '2026-10-20T22:00:00.000Z' : null,
  sets: (done ?? planned.map(([w, r]) => [w, r] as Done)).map(([weight, reps, type = 'normal']) => ({
    type,
    weight,
    reps,
  })),
  ...over,
});

const increase = (s: LoadSuggestion | null) => {
  assert.ok(s && s.kind === 'increase', `esperava aumento, veio ${JSON.stringify(s)}`);
  return s;
};

describe('incremento conservador', () => {
  it('5% da carga, em passos de 0,5 kg, entre 0,5 e 2,5 kg', () => {
    assert.equal(incrementFor(60), 2.5);
    assert.equal(incrementFor(100), 2.5);
    assert.equal(incrementFor(20), 1);
    assert.equal(incrementFor(12), 0.5);
    assert.equal(incrementFor(4), 0.5);
    for (const load of [1, 7.5, 33, 47.5, 80, 250]) {
      const step = incrementFor(load);
      assert.ok(step >= 0.5 && step <= 2.5 && Number.isInteger(step * 2), `${load} → ${step}`);
    }
  });
});

describe('suggestLoad', () => {
  it('1. objetivo atingido em todas as séries → sugere aumento pequeno em cada série', () => {
    const s = increase(
      suggestLoad(
        perf(
          [
            [40, 10],
            [40, 10],
            [40, 10],
          ],
          [
            [20, 15, 'warmup'],
            [60, 10],
            [60, 11],
            [60, 10],
          ],
        ),
      ),
    );
    assert.deepEqual(s.lastWeights, [60, 60, 60]);
    assert.deepEqual(s.suggestedWeights, [62.5, 62.5, 62.5]);
    assert.equal(s.increment, 2.5);
    assert.match(s.reason, /completou as 3 séries planejadas com 10 repetições/);
  });

  it('pirâmide planejada: aumenta todas as séries pelo mesmo incremento', () => {
    const s = increase(
      suggestLoad(
        perf(
          [
            [40, 12],
            [45, 10],
          ],
          [
            [42, 12],
            [47, 10],
          ],
        ),
      ),
    );
    assert.deepEqual(s.suggestedWeights, [44.5, 49.5]);
    assert.match(s.reason, /com 12 e 10 repetições/);
  });

  it('2. abaixo do objetivo em uma série → mantém, explicando qual', () => {
    const s = suggestLoad(
      perf(
        [
          [60, 10],
          [60, 10],
          [60, 10],
        ],
        [
          [60, 10],
          [60, 8],
          [60, 10],
        ],
      ),
    );
    assert.deepEqual(s, {
      kind: 'maintain',
      lastWeights: [60, 60, 60],
      reason: 'No último treino você fez 8 de 10 repetições na 2ª série. Mantenha a carga até atingir o objetivo.',
    });
  });

  it('2. várias séries abaixo, menos séries que o planejado, falha ou carga caindo → mantém', () => {
    const plan: [number, number][] = [
      [60, 10],
      [60, 10],
      [60, 10],
    ];
    const several = suggestLoad(perf(plan, [[60, 10], [60, 7], [60, 6]]));
    assert.equal(several?.kind, 'maintain');
    assert.match(several!.reason, /2 séries ficaram abaixo do objetivo \(ex\.: 7 de 10 repetições na 2ª série\)/);

    const fewer = suggestLoad(perf(plan, [[60, 12], [60, 12]]));
    assert.equal(fewer?.kind, 'maintain');
    assert.match(fewer!.reason, /2 de 3 séries planejadas/);

    const failure = suggestLoad(perf(plan, [[60, 10], [60, 10], [60, 10, 'failure']]));
    assert.equal(failure?.kind, 'maintain');
    assert.match(failure!.reason, /3ª série .* marcada como falha/);

    // Atingiu as repetições baixando o peso: não é consistência.
    const dropped = suggestLoad(perf(plan, [[60, 10], [60, 10], [55, 10]]));
    assert.equal(dropped?.kind, 'maintain');
    assert.match(dropped!.reason, /carga variou entre as séries \(60 kg → 55 kg na 3ª\)/);

    // Só a série isolada mais forte não basta: o drop set não conta como série de trabalho.
    const withDrop = suggestLoad(perf(plan, [[60, 10], [60, 9], [40, 12, 'drop']]));
    assert.equal(withDrop?.kind, 'maintain');
  });

  it('3. sem histórico, sem objetivo, dados inválidos ou peso corporal → nenhuma recomendação', () => {
    const plan: [number, number][] = [[60, 10]];
    assert.equal(suggestLoad(undefined), null);
    assert.equal(suggestLoad(perf(plan, null)), null); // só o planejado (source 'routine')
    assert.equal(suggestLoad(perf([], [[60, 10]])), null); // sem objetivo
    assert.equal(suggestLoad(perf(plan, [])), null);
    assert.equal(suggestLoad(perf(plan, [[20, 15, 'warmup']])), null); // só aquecimento
    assert.equal(suggestLoad(perf(plan, [[0, 15]])), null); // peso corporal
    assert.equal(suggestLoad(perf(plan, [[Number.NaN, 10]])), null);
    assert.equal(suggestLoad(perf(plan, [[60, 2.5]])), null);
    assert.equal(suggestLoad(perf([[60, 0]], [[60, 10]])), null); // objetivo inválido
    assert.equal(suggestLoad(perf(plan, [[999, 10]])), null); // passaria do limite de 1000 kg
  });
});

describe('aplicar a sugestão na sessão', () => {
  const performance = [
    perf(
      [
        [40, 10],
        [40, 10],
      ],
      [
        [20, 15, 'warmup'],
        [60, 10],
        [60, 10],
      ],
    ),
    perf([[30, 12]], [[30, 12]], { exerciseId: 'Fly', name: 'Crucifixo' }),
  ];
  let n = 0;
  const makeUid = () => `u${(n += 1)}`;
  const start = (): LiveSession =>
    startSession(
      {
        workoutId: 'w1',
        title: 'Peito',
        exercises: performance.map((p) => ({ exerciseId: p.exerciseId ?? undefined, name: p.name, sets: p.plannedSets })),
        performed: performance.map((p) => p.sets),
      },
      makeUid,
      '2026-10-27T12:00:00.000Z',
    );
  const weights = (session: LiveSession, index: number) => session.exercises[index].sets.map((set) => set.weight);

  it('4. abrir a tela e calcular a sugestão não muda nenhuma carga', () => {
    const session = start();
    const before = JSON.stringify(session);
    const refs = performanceByExercise(session.exercises, performance);
    const s = suggestLoad(refs.get(session.exercises[0].uid));
    assert.equal(s?.kind, 'increase');
    assert.equal(JSON.stringify(session), before);
    assert.deepEqual(weights(session, 0), ['20', '60', '60']);
  });

  it('5/6. aplicar muda só as séries de trabalho pendentes deste exercício; desfazer volta; manter não mexe', () => {
    let session = start();
    const bench = session.exercises[0];
    const s = increase(suggestLoad(performanceByExercise(session.exercises, performance).get(bench.uid)));
    assert.equal(suggestionState(bench, s), 'pending');

    // Uma série já feita não é alterada.
    session = { ...session, exercises: session.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((set, j) => (j === 1 ? { ...set, done: true } : set)) } : e)) };
    const applied = applySuggestion(session, bench.uid, s);
    assert.deepEqual(weights(applied, 0), ['20', '60', '62.5']); // aquecimento e série feita intactos
    assert.deepEqual(weights(applied, 1), weights(session, 1)); // outro exercício intacto
    assert.equal(suggestionState(applied.exercises[0], s), 'applied');
    // Repetições, tipos e status não mudam.
    assert.deepEqual(
      applied.exercises[0].sets.map((x) => [x.reps, x.type, x.done]),
      session.exercises[0].sets.map((x) => [x.reps, x.type, x.done]),
    );

    const undone = revertSuggestion(applied, bench.uid, s);
    assert.deepEqual(weights(undone, 0), ['20', '60', '60']);
    assert.equal(suggestionState(undone.exercises[0], s), 'pending');

    // Todas as séries de trabalho feitas: nada a sugerir para este treino.
    const allDone = { ...bench, sets: bench.sets.map((set) => ({ ...set, done: true })) };
    assert.equal(suggestionState(allDone, s), 'done');
  });

  it('7. cada exercício recebe a referência dele (por ID/nome e ocorrência), não a de outro', () => {
    const session = start();
    const refs = performanceByExercise(
      [
        session.exercises[1], // ordem trocada durante o treino
        session.exercises[0],
        { uid: 'novo', name: 'Remada', exerciseId: 'Row' }, // acrescentado no treino: sem referência
      ],
      performance,
    );
    assert.equal(refs.get(session.exercises[0].uid)?.name, 'Supino');
    assert.equal(refs.get(session.exercises[1].uid)?.name, 'Crucifixo');
    assert.equal(refs.has('novo'), false);

    // Exercício repetido na rotina: a 2ª ocorrência usa a 2ª referência.
    const twice = [perf([[60, 10]], [[60, 10]]), perf([[50, 12]], [[50, 9]])];
    const map = performanceByExercise(
      [
        { uid: 'a', exerciseId: 'Bench_Press', name: 'Supino' },
        { uid: 'b', exerciseId: 'Bench_Press', name: 'Supino' },
      ],
      twice,
    );
    assert.equal(suggestLoad(map.get('a'))?.kind, 'increase');
    assert.equal(suggestLoad(map.get('b'))?.kind, 'maintain');
  });

  it('rótulos de carga', () => {
    assert.equal(weightRangeLabel([60, 60]), '60 kg');
    assert.equal(weightRangeLabel([42, 47.5]), '42–47,5 kg');
  });
});
