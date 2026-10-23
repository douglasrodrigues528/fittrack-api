import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  addExerciseByName,
  addLiveSet,
  adjustRest,
  formatClock,
  formatDuration,
  parseStoredSession,
  removeLiveExercise,
  removeLiveSet,
  restRemainingSeconds,
  sessionStats,
  skipRest,
  startEmptySession,
  startSession,
  toggleSetDone,
  toSessionPayload,
  updateLiveSet,
  validateFinish,
  type LiveSession,
} from '../session';
import { createPersistedStore } from '../persisted-store';
import type { StorageLike } from '../draft-store';

function counter() {
  let n = 0;
  return () => `u${++n}`;
}

const NOW = Date.parse('2026-10-20T20:00:00Z');

function routineSession(): LiveSession {
  return startSession(
    {
      workoutId: 'w1',
      title: 'Peito',
      exercises: [
        { exerciseId: 'Bench', name: 'Supino', sets: [{ weight: 40, reps: 12 }, { weight: 45, reps: 10 }] },
        { name: 'Crucifixo', sets: [] },
      ],
      previous: [{ name: 'Supino', sets: [{ type: 'normal', weight: 37.5, reps: 12 }] }, null],
    },
    counter(),
    '2026-10-20T19:00:00.000Z',
  );
}

function setUids(session: LiveSession, exerciseIndex: number) {
  return session.exercises[exerciseIndex].sets.map((s) => s.uid);
}

describe('startSession', () => {
  it('cria séries a cumprir a partir do plano, pré-preenchidas e não concluídas', () => {
    const s = routineSession();
    assert.equal(s.exercises.length, 2);
    assert.deepEqual(
      s.exercises[0].sets.map((x) => [x.weight, x.reps, x.done, x.type]),
      [['40', '12', false, 'normal'], ['45', '10', false, 'normal']],
    );
    assert.equal(s.exercises[0].previous[0].weight, 37.5);
    assert.equal(s.exercises[0].exerciseId, 'Bench');
    assert.equal(s.workoutId, 'w1');
  });

  it('exercício sem séries planejadas ganha uma série em branco', () => {
    const s = routineSession();
    assert.equal(s.exercises[1].sets.length, 1);
    assert.equal(s.exercises[1].sets[0].weight, '');
    assert.deepEqual(s.exercises[1].previous, []);
  });

  it('todos os uids são únicos', () => {
    const s = routineSession();
    const uids = [...s.exercises.map((e) => e.uid), ...s.exercises.flatMap((e) => e.sets.map((x) => x.uid))];
    assert.equal(new Set(uids).size, uids.length);
  });
});

describe('concluir série e descanso', () => {
  it('conclui, inicia o descanso e permite desmarcar', () => {
    const s = routineSession();
    const [ex] = s.exercises;
    const done = toggleSetDone(s, ex.uid, ex.sets[0].uid, NOW);
    assert.ok(!('error' in done));
    if ('error' in done) return;
    assert.equal(done.exercises[0].sets[0].done, true);
    assert.equal(done.restEndsAt, NOW + 90_000);
    assert.equal(restRemainingSeconds(done, NOW), 90);
    assert.equal(restRemainingSeconds(done, NOW + 30_500), 60);
    assert.equal(restRemainingSeconds(done, NOW + 999_000), 0);
    const undone = toggleSetDone(done, ex.uid, ex.sets[0].uid, NOW);
    assert.ok(!('error' in undone));
    if (!('error' in undone)) assert.equal(undone.exercises[0].sets[0].done, false);
  });

  it('não conclui série com campos vazios ou inválidos e não inicia descanso', () => {
    const s = routineSession();
    const ex = s.exercises[1];
    const empty = toggleSetDone(s, ex.uid, ex.sets[0].uid, NOW);
    assert.ok('error' in empty);
    const bad = updateLiveSet(s, ex.uid, ex.sets[0].uid, { weight: '20', reps: '0' });
    assert.ok('error' in toggleSetDone(bad, ex.uid, ex.sets[0].uid, NOW));
    assert.equal(s.restEndsAt, null);
  });

  it('aceita peso 0 e vírgula decimal', () => {
    const s = routineSession();
    const ex = s.exercises[1];
    const filled = updateLiveSet(s, ex.uid, ex.sets[0].uid, { weight: '0', reps: '15' });
    assert.ok(!('error' in toggleSetDone(filled, ex.uid, ex.sets[0].uid, NOW)));
    const comma = updateLiveSet(s, ex.uid, ex.sets[0].uid, { weight: '42,5', reps: '8' });
    assert.ok(!('error' in toggleSetDone(comma, ex.uid, ex.sets[0].uid, NOW)));
  });

  it('ajusta e pula o descanso', () => {
    const s = routineSession();
    const ex = s.exercises[0];
    const done = toggleSetDone(s, ex.uid, ex.sets[0].uid, NOW) as LiveSession;
    assert.equal(adjustRest(done, 15, NOW).restEndsAt, NOW + 105_000);
    assert.equal(adjustRest(done, -999, NOW).restEndsAt, NOW);
    assert.equal(skipRest(done).restEndsAt, null);
    assert.equal(adjustRest(s, 15, NOW), s);
  });

  it('editar valores de uma série concluída exige reconfirmar; mudar o tipo não', () => {
    const s = routineSession();
    const ex = s.exercises[0];
    const done = toggleSetDone(s, ex.uid, ex.sets[0].uid, NOW) as LiveSession;
    assert.equal(updateLiveSet(done, ex.uid, ex.sets[0].uid, { reps: '11' }).exercises[0].sets[0].done, false);
    assert.equal(updateLiveSet(done, ex.uid, ex.sets[0].uid, { type: 'warmup' }).exercises[0].sets[0].done, true);
  });
});

describe('adicionar e remover durante o treino', () => {
  it('nova série copia a anterior; remover série e exercício afeta só o alvo', () => {
    const s = routineSession();
    const ex = s.exercises[0];
    const added = addLiveSet(s, ex.uid, counter());
    assert.equal(added.exercises[0].sets.length, 3);
    assert.equal(added.exercises[0].sets[2].weight, '45');
    assert.equal(added.exercises[0].sets[2].done, false);
    const removed = removeLiveSet(added, ex.uid, ex.sets[0].uid);
    assert.deepEqual(setUids(removed, 0).length, 2);
    assert.equal(removed.exercises[1].sets.length, 1);
    assert.equal(removeLiveExercise(s, ex.uid).exercises.length, 1);
  });

  it('adiciona exercício por nome e exige nome', () => {
    const s = startEmptySession(counter(), '2026-10-20T19:00:00.000Z');
    assert.ok('error' in addExerciseByName(s, '  ', counter()));
    const next = addExerciseByName(s, ' Remada ', counter());
    assert.ok(!('error' in next));
    if (!('error' in next)) assert.equal(next.exercises[0].name, 'Remada');
  });
});

describe('finalização', () => {
  function withDone() {
    let s = routineSession();
    const ex = s.exercises[0];
    for (const set of ex.sets) {
      const r = toggleSetDone(s, ex.uid, set.uid, NOW);
      assert.ok(!('error' in r));
      s = r as LiveSession;
    }
    return s;
  }

  it('bloqueia finalizar sem nenhuma série concluída', () => {
    assert.ok(validateFinish(routineSession()));
    assert.equal(validateFinish(withDone()), null);
  });

  it('estatísticas: volume sem aquecimento', () => {
    let s = withDone();
    assert.deepEqual(sessionStats(s), { doneSets: 2, totalSets: 3, pendingSets: 1, volume: 40 * 12 + 45 * 10 });
    s = updateLiveSet(s, s.exercises[0].uid, s.exercises[0].sets[0].uid, { type: 'warmup' });
    assert.equal(sessionStats(s).volume, 45 * 10);
  });

  it('payload leva só séries concluídas, omite exercícios sem séries e campos vazios', () => {
    const s = withDone();
    const payload = toSessionPayload(s, '2026-10-20T20:00:00.000Z');
    assert.deepEqual(payload, {
      workoutId: 'w1',
      title: 'Peito',
      startedAt: '2026-10-20T19:00:00.000Z',
      finishedAt: '2026-10-20T20:00:00.000Z',
      exercises: [
        {
          exerciseId: 'Bench',
          name: 'Supino',
          sets: [
            { type: 'normal', weight: 40, reps: 12 },
            { type: 'normal', weight: 45, reps: 10 },
          ],
        },
      ],
    });
  });

  it('inclui notas quando preenchidas', () => {
    const s = { ...withDone(), notes: ' ótimo ' };
    assert.equal(toSessionPayload(s, '2026-10-20T20:00:00.000Z').notes, 'ótimo');
  });
});

describe('formatação', () => {
  it('duração e relógio', () => {
    assert.equal(formatDuration(2700), '45 min');
    assert.equal(formatDuration(3725), '1h 02min');
    assert.equal(formatClock(75), '1:15');
    assert.equal(formatClock(-5), '0:00');
  });
});

describe('parseStoredSession e store persistido', () => {
  it('rejeita lixo e aproveita o que for válido', () => {
    for (const v of [null, 1, {}, { startedAt: 'x', exercises: [] }, { startedAt: '2026-01-01T00:00:00Z' }]) {
      assert.equal(parseStoredSession(v, counter()), null);
    }
    const parsed = parseStoredSession(
      {
        startedAt: '2026-01-01T00:00:00Z',
        exercises: [{ name: 'A', sets: [{ weight: '1', reps: '2', done: true, type: 'bogus' }, 5] }, { name: '' }],
      },
      counter(),
    );
    assert.ok(parsed);
    assert.equal(parsed.exercises.length, 1);
    assert.equal(parsed.exercises[0].sets[0].type, 'normal');
    assert.equal(parsed.restSeconds, 90);
  });

  class Mem implements StorageLike {
    d = new Map<string, string>();
    getItem(k: string) { return this.d.get(k) ?? null; }
    setItem(k: string, v: string) { this.d.set(k, v); }
    removeItem(k: string) { this.d.delete(k); }
  }

  it('a sessão em andamento sobrevive a recarregar e é separada por usuário', () => {
    const storage = new Mem();
    let user = 'u1';
    const make = () =>
      createPersistedStore<LiveSession | null>({
        storage,
        getUserKey: () => user,
        keyFor: (u) => `live:${u}`,
        empty: null,
        isEmpty: (v) => v === null,
        parse: (raw) => parseStoredSession(raw, counter()),
      });
    const a = make();
    a.set(routineSession());
    const b = make();
    assert.equal(b.getSnapshot()?.title, 'Peito');
    assert.equal(b.getSnapshot()?.exercises[0].sets.length, 2);
    user = 'u2';
    assert.equal(make().getSnapshot(), null);
    user = 'u1';
    b.clear();
    assert.equal(storage.getItem('live:u1'), null);
  });
});
