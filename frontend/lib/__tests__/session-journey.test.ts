import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  addCatalogExerciseToSession,
  addLiveSet,
  countInSession,
  hasPendingSync,
  moveLiveExercise,
  referenceSetsFor,
  parseStoredSession,
  removeLiveExercise,
  removeLiveSet,
  sessionFromServer,
  startEmptySession,
  startInputFromPerformance,
  startSession,
  toFinishPayload,
  toggleSetDone,
  toProgressPayload,
  touchSession,
  updateLiveSet,
  type LiveSession,
} from '../session';

function counter(prefix = 'u') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const START = '2026-10-22T10:00:00.000Z';
const NOW = Date.parse('2026-10-22T10:30:00.000Z');

function freeWithTwo(): LiveSession {
  const uid = counter();
  let s = startEmptySession(uid, START);
  for (const ref of [
    { id: 'Squat', name: 'Agachamento' },
    { id: 'Bench', name: 'Supino' },
  ]) {
    const r = addCatalogExerciseToSession(s, ref, uid);
    assert.equal(r.status, 'added');
    s = r.session;
  }
  return s;
}

describe('treino livre', () => {
  it('começa sem rotina, sem exercícios e pendente de envio ao servidor', () => {
    const s = startEmptySession(counter(), START);
    assert.equal(s.origin, 'free');
    assert.equal(s.workoutId, null);
    assert.equal(s.serverId, null);
    assert.deepEqual(s.exercises, []);
    assert.equal(hasPendingSync(s), true);
  });

  it('a partir de uma rotina, a origem é "planned"', () => {
    const s = startSession({ workoutId: 'w1', title: 'A', exercises: [] }, counter(), START);
    assert.equal(s.origin, 'planned');
  });

  it('adicionar do catálogo preserva os anteriores e já cria uma série em branco', () => {
    const s = freeWithTwo();
    assert.deepEqual(
      s.exercises.map((e) => [e.exerciseId, e.name, e.sets.length]),
      [
        ['Squat', 'Agachamento', 1],
        ['Bench', 'Supino', 1],
      ],
    );
  });

  it('duplicata acidental é detectada; repetir de propósito é permitido', () => {
    const s = freeWithTwo();
    const dup = addCatalogExerciseToSession(s, { id: 'Bench', name: 'Supino' }, counter('d'));
    assert.equal(dup.status, 'duplicate');
    assert.equal(dup.session, s, 'nada muda sem confirmação');
    const again = addCatalogExerciseToSession(s, { id: 'Bench', name: 'Supino' }, counter('x'), {
      allowDuplicate: true,
    });
    assert.equal(again.status, 'added');
    assert.equal(countInSession(again.session, 'Bench'), 2);
  });

  it('séries distintas por exercício; remover série e exercício individualmente', () => {
    const uid = counter('n');
    let s = freeWithTwo();
    const [squat, bench] = s.exercises;
    s = addLiveSet(s, squat.uid, uid);
    s = updateLiveSet(s, squat.uid, s.exercises[0].sets[0].uid, { weight: '60', reps: '10' });
    s = updateLiveSet(s, squat.uid, s.exercises[0].sets[1].uid, { weight: '70', reps: '8' });
    s = updateLiveSet(s, bench.uid, s.exercises[1].sets[0].uid, { weight: '40', reps: '12' });
    assert.deepEqual(
      s.exercises.map((e) => e.sets.map((x) => `${x.weight}x${x.reps}`)),
      [['60x10', '70x8'], ['40x12']],
    );

    s = removeLiveSet(s, squat.uid, s.exercises[0].sets[0].uid);
    assert.deepEqual(s.exercises[0].sets.map((x) => x.weight), ['70']);
    s = removeLiveExercise(s, bench.uid);
    assert.deepEqual(s.exercises.map((e) => e.name), ['Agachamento']);
  });

  it('reordena exercícios sem perder séries', () => {
    const s = freeWithTwo();
    const moved = moveLiveExercise(s, s.exercises[1].uid, -1);
    assert.deepEqual(moved.exercises.map((e) => e.name), ['Supino', 'Agachamento']);
    assert.equal(moveLiveExercise(moved, moved.exercises[0].uid, -1), moved);
  });
});

describe('sincronização', () => {
  it('touchSession marca alteração pendente e ignora não-alterações', () => {
    const base = { ...freeWithTwo(), serverId: 's1' };
    const synced = { ...base, syncedAt: base.updatedAt };
    assert.equal(hasPendingSync(synced), false);
    assert.equal(touchSession(synced, synced, NOW), synced);
    const edited = touchSession(synced, { ...synced, title: 'Novo' }, NOW);
    assert.equal(hasPendingSync(edited), true);
    assert.ok(edited.updatedAt > synced.updatedAt);
  });

  it('o progresso enviado só tem os campos aceitos pela API (sem ids locais ou do servidor)', () => {
    const s = { ...freeWithTwo(), serverId: 'srv', notes: 'ok' };
    const payload = toProgressPayload(s);
    assert.deepEqual(Object.keys(payload).sort(), ['exercises', 'notes', 'restSeconds', 'title']);
    assert.deepEqual(Object.keys(payload.exercises[0]).sort(), ['exerciseId', 'name', 'previous', 'sets', 'uid']);
    assert.deepEqual(Object.keys(payload.exercises[0].sets[0]).sort(), ['done', 'reps', 'type', 'uid', 'weight']);
    const text = JSON.stringify(payload);
    assert.ok(!text.includes('srv') && !text.includes('localId') && !text.includes('restEndsAt'));
  });

  it('retomar a partir do servidor reconstrói exercícios e séries (inclusive não concluídas)', () => {
    let s = freeWithTwo();
    const set = s.exercises[0].sets[0];
    s = updateLiveSet(s, s.exercises[0].uid, set.uid, { weight: '60', reps: '10' });
    const toggled = toggleSetDone(s, s.exercises[0].uid, set.uid, NOW);
    assert.ok(!('error' in toggled));
    const restored = sessionFromServer(
      {
        id: 'srv-1',
        origin: 'free',
        workoutId: null,
        title: 'Treino livre',
        startedAt: START,
        progress: JSON.parse(JSON.stringify(toProgressPayload(toggled))) as unknown,
      },
      counter('r'),
      NOW,
    );
    assert.equal(restored.serverId, 'srv-1');
    assert.equal(hasPendingSync(restored), false);
    assert.equal(restored.startedAt, START);
    assert.deepEqual(
      restored.exercises.map((e) => e.sets.map((x) => [x.weight, x.reps, x.done])),
      [[['60', '10', true]], [['', '', false]]],
    );
    assert.deepEqual(
      restored.exercises.map((e) => e.uid),
      toggled.exercises.map((e) => e.uid),
    );
  });

  it('progresso vazio no servidor ainda gera uma sessão utilizável', () => {
    const restored = sessionFromServer(
      { id: 'srv', origin: 'planned', workoutId: 'w1', title: 'Peito', startedAt: START, progress: null },
      counter(),
      NOW,
    );
    assert.equal(restored.title, 'Peito');
    assert.deepEqual(restored.exercises, []);
    assert.equal(restored.origin, 'planned');
  });

  it('sessão salva no aparelho antes desta versão é lida e fica pendente de envio', () => {
    const legacy = {
      workoutId: 'w1',
      title: 'Antigo',
      startedAt: START,
      notes: '',
      exercises: [
        { uid: 'e1', name: 'Supino', sets: [{ uid: 's1', type: 'normal', weight: '40', reps: '10', done: true }] },
      ],
      restEndsAt: null,
      restSeconds: 90,
    };
    const parsed = parseStoredSession(legacy, counter());
    assert.ok(parsed);
    assert.equal(parsed.serverId, null);
    assert.equal(parsed.origin, 'planned');
    assert.equal(parsed.exercises[0].sets[0].done, true);
    assert.equal(hasPendingSync(parsed), true);
  });

  it('a conclusão envia só as séries realizadas', () => {
    let s = freeWithTwo();
    const [squat] = s.exercises;
    s = updateLiveSet(s, squat.uid, squat.sets[0].uid, { weight: '60', reps: '10' });
    const done = toggleSetDone(s, squat.uid, squat.sets[0].uid, NOW);
    assert.ok(!('error' in done));
    const payload = toFinishPayload({ ...done, title: ' Livre ' }, '2026-10-22T11:00:00.000Z');
    assert.deepEqual(payload, {
      title: 'Livre',
      finishedAt: '2026-10-22T11:00:00.000Z',
      exercises: [{ exerciseId: 'Squat', name: 'Agachamento', sets: [{ type: 'normal', weight: 60, reps: 10 }] }],
    });
  });
});

describe('iniciar rotina a partir do último treino concluído', () => {
  const performance = [
    {
      exerciseId: 'Bench_Press',
      name: 'Supino',
      plannedSets: [
        { weight: 20, reps: 10 },
        { weight: 20, reps: 10 },
        { weight: 20, reps: 10 },
      ],
      source: 'last_session' as const,
      performedAt: '2026-10-21T10:00:00.000Z',
      sets: [
        { type: 'warmup', weight: 10, reps: 15 },
        { type: 'normal', weight: 22, reps: 12 },
        { type: 'normal', weight: 22, reps: 12 },
        { type: 'normal', weight: 22, reps: 12 },
      ],
    },
    {
      exerciseId: null,
      name: 'Exercício novo',
      plannedSets: [{ weight: 40, reps: 8 }],
      source: 'routine' as const,
      performedAt: null,
      sets: [{ type: 'normal', weight: 40, reps: 8 }],
    },
  ];

  it('pré-preenche com o que foi FEITO (séries, cargas, reps e tipo), não com o planejado', () => {
    const s = startSession(startInputFromPerformance('w1', 'Peito', performance), counter(), START);
    assert.equal(s.workoutId, 'w1');
    assert.deepEqual(
      s.exercises[0].sets.map((x) => [x.type, x.weight, x.reps, x.done]),
      [
        ['warmup', '10', '15', false],
        ['normal', '22', '12', false],
        ['normal', '22', '12', false],
        ['normal', '22', '12', false],
      ],
    );
    assert.deepEqual(s.exercises[0].previous.map((x) => x.weight), [10, 22, 22, 22], 'coluna "Anterior" = último treino');
    assert.equal(s.exercises[0].exerciseId, 'Bench_Press');
  });

  it('exercício sem histórico usa as séries planejadas da rotina e não mostra "Anterior"', () => {
    const s = startSession(startInputFromPerformance('w1', 'Peito', performance), counter(), START);
    assert.deepEqual(s.exercises[1].sets.map((x) => [x.weight, x.reps]), [['40', '8']]);
    assert.deepEqual(s.exercises[1].previous, []);
    assert.equal(s.exercises[1].exerciseId, undefined);
  });

  it('primeira execução (sem `performed`) mantém o comportamento original', () => {
    const s = startSession(
      { workoutId: 'w1', title: 'A', exercises: [{ name: 'Supino', sets: [{ weight: 20, reps: 10 }] }] },
      counter(),
      START,
    );
    assert.deepEqual(s.exercises[0].sets.map((x) => [x.weight, x.reps]), [['20', '10']]);
  });
});

describe('dashboard: séries exibidas = mesma referência do iniciar treino', () => {
  const routine = [
    { exerciseId: 'Bench_Press', name: 'Supino', sets: [{ weight: 20, reps: 10 }, { weight: 20, reps: 10 }, { weight: 20, reps: 10 }] },
    { name: 'Exercício novo', sets: [{ weight: 40, reps: 8 }] },
  ];
  const performance = [
    {
      exerciseId: 'Bench_Press',
      name: 'Supino',
      plannedSets: routine[0].sets,
      source: 'last_session' as const,
      performedAt: '2026-10-21T10:00:00.000Z',
      sets: [
        { type: 'normal', weight: 22, reps: 12 },
        { type: 'normal', weight: 22, reps: 12 },
        { type: 'normal', weight: 22, reps: 12 },
      ],
    },
    {
      exerciseId: null,
      name: 'Exercício novo',
      plannedSets: routine[1].sets,
      source: 'routine' as const,
      performedAt: null,
      sets: [{ type: 'normal', weight: 40, reps: 8 }],
    },
  ];

  it('mostra as séries do último treino concluído, iguais às que o iniciar treino carrega', () => {
    const shown = referenceSetsFor(routine[0], 0, performance);
    assert.equal(shown.source, 'last_session');
    assert.deepEqual(shown.sets.map((x) => `${x.weight}x${x.reps}`), ['22x12', '22x12', '22x12']);
    const started = startSession(startInputFromPerformance('w1', 'Peito', performance), counter(), START);
    assert.deepEqual(
      started.exercises[0].sets.map((x) => `${x.weight}x${x.reps}`),
      shown.sets.map((x) => `${x.weight}x${x.reps}`),
    );
  });

  it('exercício sem histórico mostra o planejado', () => {
    assert.deepEqual(referenceSetsFor(routine[1], 1, performance), {
      source: 'routine',
      performedAt: null,
      sets: [{ type: 'normal', weight: 40, reps: 8 }],
    });
  });

  it('sem referência (falha de rede) ou referência de outro exercício: mostra o planejado', () => {
    assert.equal(referenceSetsFor(routine[0], 0, undefined).sets[0].weight, 20);
    // Rotina editada após a busca: posição 0 agora é outro exercício.
    assert.equal(referenceSetsFor({ exerciseId: 'Squat', name: 'Agachamento', sets: [{ weight: 50, reps: 5 }] }, 0, performance).sets[0].weight, 50);
  });
});
