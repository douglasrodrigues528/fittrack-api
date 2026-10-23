import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  addCatalogExercise,
  addCustomExercise,
  addSet,
  draftFromWorkout,
  emptyDraft,
  formatWeekdays,
  isDraftEmpty,
  moveExercise,
  parseSetInput,
  parseStoredDraft,
  removeExercise,
  removeSet,
  toPayload,
  toggleWeekday,
  updateSet,
  validateForSave,
  type WorkoutDraft,
} from '../workout-draft';

function counter() {
  let n = 0;
  return () => `uid-${++n}`;
}

function withExercises(...names: string[]): { draft: WorkoutDraft; uids: string[] } {
  const makeUid = counter();
  let draft = emptyDraft();
  const uids: string[] = [];
  for (const name of names) {
    const result = addCatalogExercise(draft, { id: name, name }, makeUid);
    assert.equal(result.status, 'added');
    if (result.status === 'added') {
      draft = result.draft;
      uids.push(result.uid);
    }
  }
  return { draft, uids };
}

describe('addCatalogExercise', () => {
  it('insere o exercício no rascunho sem exigir digitação e sem séries', () => {
    const result = addCatalogExercise(emptyDraft(), { id: 'Bench_Press', name: 'Supino reto' }, counter());
    assert.equal(result.status, 'added');
    assert.deepEqual(result.draft.exercises, [
      { uid: 'uid-1', exerciseId: 'Bench_Press', name: 'Supino reto', sets: [] },
    ]);
  });

  it('não apaga nem substitui os exercícios já selecionados', () => {
    const { draft } = withExercises('A', 'B', 'C');
    assert.deepEqual(
      draft.exercises.map((e) => e.name),
      ['A', 'B', 'C'],
    );
  });

  it('preserva título, descrição e o modo de edição', () => {
    const base: WorkoutDraft = { editingId: 'w1', title: 'Peito', description: 'Força', exercises: [], weekdays: [] };
    const result = addCatalogExercise(base, { id: 'x', name: 'X' }, counter());
    assert.equal(result.draft.editingId, 'w1');
    assert.equal(result.draft.title, 'Peito');
    assert.equal(result.draft.description, 'Força');
  });

  it('não muta o rascunho original', () => {
    const base = emptyDraft();
    addCatalogExercise(base, { id: 'x', name: 'X' }, counter());
    assert.equal(base.exercises.length, 0);
  });

  it('sinaliza duplicata acidental sem alterar nada', () => {
    const { draft } = withExercises('A');
    const again = addCatalogExercise(draft, { id: 'A', name: 'A' }, counter());
    assert.equal(again.status, 'duplicate');
    assert.equal(again.draft, draft);
  });

  it('permite repetir o mesmo exercício quando intencional, com séries independentes', () => {
    const { draft } = withExercises('A');
    const again = addCatalogExercise(draft, { id: 'A', name: 'A' }, () => 'uid-dup', { allowDuplicate: true });
    assert.equal(again.status, 'added');
    const withSet = addSet(again.draft, 'uid-dup', { weight: 10, reps: 5 });
    assert.equal(withSet.exercises[0].sets.length, 0);
    assert.equal(withSet.exercises[1].sets.length, 1);
  });
});

describe('addCustomExercise', () => {
  it('exige nome', () => {
    assert.ok('error' in addCustomExercise(emptyDraft(), '   ', counter()));
  });
  it('adiciona sem exerciseId', () => {
    const result = addCustomExercise(emptyDraft(), '  Remada  ', counter());
    assert.ok('draft' in result);
    if ('draft' in result) assert.deepEqual(result.draft.exercises[0], { uid: 'uid-1', name: 'Remada', sets: [] });
  });
});

describe('séries', () => {
  it('cada exercício tem as próprias séries; adicionar várias e remover individualmente', () => {
    const { draft, uids } = withExercises('A', 'B');
    let next = addSet(draft, uids[0], { weight: 40, reps: 12 });
    next = addSet(next, uids[0], { weight: 45, reps: 10 });
    next = addSet(next, uids[0], { weight: 50, reps: 8 });
    next = addSet(next, uids[1], { weight: 20, reps: 15 });
    next = removeSet(next, uids[0], 1);
    assert.deepEqual(next.exercises[0].sets, [
      { weight: 40, reps: 12 },
      { weight: 50, reps: 8 },
    ]);
    assert.deepEqual(next.exercises[1].sets, [{ weight: 20, reps: 15 }]);
  });

  it('edita uma série sem afetar as outras', () => {
    const { draft, uids } = withExercises('A');
    let next = addSet(draft, uids[0], { weight: 40, reps: 12 });
    next = addSet(next, uids[0], { weight: 45, reps: 10 });
    next = updateSet(next, uids[0], 1, { reps: 9 });
    assert.deepEqual(next.exercises[0].sets, [
      { weight: 40, reps: 12 },
      { weight: 45, reps: 9 },
    ]);
  });

  it('parseSetInput valida peso e repetições', () => {
    assert.deepEqual(parseSetInput('0', '10'), { set: { weight: 0, reps: 10 } });
    assert.deepEqual(parseSetInput('42,5', '8'), { set: { weight: 42.5, reps: 8 } });
    for (const [w, r] of [['', '10'], ['10', ''], ['-1', '10'], ['10', '0'], ['10', '2.5'], ['abc', '10']]) {
      assert.ok('error' in parseSetInput(w, r), `${w}/${r} deveria ser inválido`);
    }
  });
});

describe('remover e reordenar exercícios', () => {
  it('remove só o exercício escolhido', () => {
    const { draft, uids } = withExercises('A', 'B', 'C');
    const next = removeExercise(draft, uids[1]);
    assert.deepEqual(
      next.exercises.map((e) => e.name),
      ['A', 'C'],
    );
  });

  it('move para cima/baixo e ignora limites', () => {
    const { draft, uids } = withExercises('A', 'B', 'C');
    assert.deepEqual(
      moveExercise(draft, uids[2], -1).exercises.map((e) => e.name),
      ['A', 'C', 'B'],
    );
    assert.equal(moveExercise(draft, uids[0], -1), draft);
    assert.equal(moveExercise(draft, uids[2], 1), draft);
  });
});

describe('validateForSave', () => {
  it('permite adicionar sem séries, mas bloqueia o salvamento com mensagem clara', () => {
    const { draft } = withExercises('Supino', 'Agachamento');
    const errors = validateForSave({ ...draft, title: 'Treino' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Supino, Agachamento/);
  });

  it('exige título', () => {
    assert.ok(validateForSave(emptyDraft()).some((m) => /título/i.test(m)));
  });

  it('aceita rascunho completo', () => {
    const { draft, uids } = withExercises('A');
    assert.deepEqual(validateForSave({ ...addSet(draft, uids[0], { weight: 0, reps: 1 }), title: 'T' }), []);
  });

  it('rejeita séries inválidas vindas de edição', () => {
    const { draft, uids } = withExercises('A');
    const bad = updateSet(addSet(draft, uids[0], { weight: 10, reps: 5 }), uids[0], 0, { reps: 0 });
    assert.ok(validateForSave({ ...bad, title: 'T' }).length > 0);
  });
});

describe('toPayload / draftFromWorkout (compatibilidade com treinos existentes)', () => {
  it('remove uid e envia todos os exercícios com suas séries', () => {
    const { draft, uids } = withExercises('A', 'B');
    let next = addSet(draft, uids[0], { weight: 40, reps: 12 });
    next = addSet(next, uids[1], { weight: 20, reps: 15 });
    const payload = toPayload({ ...next, title: ' T ', description: ' D ', weekdays: [5, 1] });
    assert.deepEqual(payload, {
      title: 'T',
      description: 'D',
      exercises: [
        { exerciseId: 'A', name: 'A', sets: [{ weight: 40, reps: 12 }] },
        { exerciseId: 'B', name: 'B', sets: [{ weight: 20, reps: 15 }] },
      ],
      weekdays: [1, 5],
    });
    assert.ok(!JSON.stringify(payload).includes('uid'));
  });

  it('abre treino antigo (sem exerciseId) para edição e ida-e-volta preserva os dados', () => {
    const saved = {
      id: 'w9',
      title: 'Antigo',
      description: null,
      exercises: [{ name: 'Supino reto', sets: [{ weight: 40, reps: 12 }, { weight: 45, reps: 10 }] }],
    };
    const draft = draftFromWorkout(saved, counter());
    assert.equal(draft.editingId, 'w9');
    assert.equal(draft.description, '');
    assert.deepEqual(toPayload(draft).exercises, saved.exercises);
  });

  it('treino sem lista de exercícios vira rascunho vazio de exercícios', () => {
    assert.deepEqual(draftFromWorkout({ id: 'x', title: 'T' }, counter()).exercises, []);
  });

  it('treino antigo sem dias da semana abre sem dia fixo; com dias, preserva', () => {
    assert.deepEqual(draftFromWorkout({ id: 'x', title: 'T' }, counter()).weekdays, []);
    assert.deepEqual(draftFromWorkout({ id: 'x', title: 'T', weekdays: [4, 2] }, counter()).weekdays, [2, 4]);
  });
});

describe('dias da semana', () => {
  it('alterna dias mantendo a ordem e o rascunho deixa de estar vazio', () => {
    let draft = toggleWeekday(emptyDraft(), 5);
    draft = toggleWeekday(draft, 1);
    assert.deepEqual(draft.weekdays, [1, 5]);
    assert.equal(isDraftEmpty(draft), false);
    assert.deepEqual(toggleWeekday(draft, 5).weekdays, [1]);
  });

  it('formata os dias em português', () => {
    assert.equal(formatWeekdays([5, 1, 3]), 'Seg, Qua e Sex');
    assert.equal(formatWeekdays([0]), 'Dom');
    assert.equal(formatWeekdays([]), '');
    assert.equal(formatWeekdays(null), '');
  });

  it('rascunho salvo no formato antigo (sem weekdays) continua válido', () => {
    const parsed = parseStoredDraft({ title: 'X', exercises: [] }, counter());
    assert.deepEqual(parsed?.weekdays, []);
    assert.deepEqual(parseStoredDraft({ title: 'X', weekdays: [9, 2, 'a', 2] }, counter())?.weekdays, [2]);
  });
});

describe('parseStoredDraft', () => {
  it('rejeita lixo', () => {
    for (const v of [null, 'x', 3, [], undefined]) assert.equal(parseStoredDraft(v, counter()), null);
  });

  it('migra o formato antigo (sem uid, com campos extras) e gera uids únicos', () => {
    const legacy = {
      title: 'T',
      editingId: 'w1',
      exerciseName: 'ignorado',
      currentSets: [{ weight: 1, reps: 1 }],
      exercises: [
        { name: 'A', sets: [{ weight: 10, reps: 5 }] },
        { name: 'B', exerciseId: 'B_id' },
        { name: '' },
        { sets: [] },
      ],
    };
    const draft = parseStoredDraft(legacy, counter());
    assert.ok(draft);
    assert.equal(draft.editingId, 'w1');
    assert.deepEqual(draft.exercises, [
      { uid: 'uid-1', name: 'A', sets: [{ weight: 10, reps: 5 }] },
      { uid: 'uid-2', exerciseId: 'B_id', name: 'B', sets: [] },
    ]);
  });

  it('corrige uids repetidos', () => {
    const draft = parseStoredDraft(
      { exercises: [{ uid: 'same', name: 'A' }, { uid: 'same', name: 'B' }] },
      counter(),
    );
    assert.ok(draft);
    assert.notEqual(draft.exercises[0].uid, draft.exercises[1].uid);
  });
});
