import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createDraftStore,
  draftStorageKey,
  LEGACY_DRAFT_KEY,
  type StorageLike,
} from '../draft-store';
import { addCatalogExercise, addSet, emptyDraft } from '../workout-draft';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

function makeStore(storage: StorageLike | null, user = () => 'u1') {
  let n = 0;
  return createDraftStore({ storage, getUserKey: user, makeUid: () => `uid-${++n}` });
}

function add(store: ReturnType<typeof makeStore>, id: string) {
  store.update((d) => addCatalogExercise(d, { id, name: id }, () => `uid-${id}`).draft);
}

describe('draft store', () => {
  it('mantém exercícios adicionados em sequência (catálogo → dashboard → catálogo)', () => {
    const storage = new MemoryStorage();
    const first = makeStore(storage);
    first.update((d) => ({ ...d, title: 'Peito', description: 'Força' }));
    add(first, 'A');
    // simula navegar (nova instância do módulo, mesmo localStorage)
    const second = makeStore(storage);
    add(second, 'B');
    const third = makeStore(storage);
    const draft = third.getSnapshot();
    assert.equal(draft.title, 'Peito');
    assert.equal(draft.description, 'Força');
    assert.deepEqual(draft.exercises.map((e) => e.name), ['A', 'B']);
  });

  it('preserva séries e o estado de edição entre navegações', () => {
    const storage = new MemoryStorage();
    const a = makeStore(storage);
    a.update((d) => ({ ...d, editingId: 'w1', title: 'T' }));
    add(a, 'A');
    a.update((d) => addSet(d, 'uid-A', { weight: 40, reps: 12 }));
    const b = makeStore(storage).getSnapshot();
    assert.equal(b.editingId, 'w1');
    assert.deepEqual(b.exercises[0].sets, [{ weight: 40, reps: 12 }]);
  });

  it('notifica assinantes e mantém a mesma referência quando nada muda', () => {
    const store = makeStore(new MemoryStorage());
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    const before = store.getSnapshot();
    assert.equal(store.getSnapshot(), before);
    add(store, 'A');
    assert.equal(calls, 1);
    assert.notEqual(store.getSnapshot(), before);
    store.update((d) => d);
    assert.equal(calls, 1);
    unsubscribe();
    add(store, 'B');
    assert.equal(calls, 1);
  });

  it('clear remove o rascunho do storage; antes disso os dados continuam lá', () => {
    const storage = new MemoryStorage();
    const store = makeStore(storage);
    add(store, 'A');
    assert.ok(storage.getItem(draftStorageKey('u1')));
    store.clear();
    assert.equal(storage.getItem(draftStorageKey('u1')), null);
    assert.deepEqual(store.getSnapshot(), emptyDraft());
  });

  it('separa rascunhos por usuário', () => {
    const storage = new MemoryStorage();
    let user = 'u1';
    const store = makeStore(storage, () => user);
    add(store, 'A');
    user = 'u2';
    assert.equal(store.getSnapshot().exercises.length, 0);
    add(store, 'B');
    user = 'u1';
    assert.deepEqual(store.getSnapshot().exercises.map((e) => e.name), ['A']);
  });

  it('migra o rascunho antigo e apaga as chaves antigas (caixa de entrada de exercício)', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_DRAFT_KEY,
      JSON.stringify({ title: 'Velho', exercises: [{ name: 'X', sets: [{ weight: 1, reps: 2 }] }] }),
    );
    storage.setItem('fittrack:selected-exercise', '{"id":"a","name":"b"}');
    const draft = makeStore(storage).getSnapshot();
    assert.equal(draft.title, 'Velho');
    assert.equal(draft.exercises.length, 1);
    assert.equal(storage.getItem(LEGACY_DRAFT_KEY), null);
    assert.equal(storage.getItem('fittrack:selected-exercise'), null);
    assert.ok(storage.getItem(draftStorageKey('u1')));
  });

  it('ignora JSON corrompido sem quebrar', () => {
    const storage = new MemoryStorage();
    storage.setItem(draftStorageKey('u1'), '{not json');
    const original = console.error;
    console.error = () => undefined;
    try {
      assert.deepEqual(makeStore(storage).getSnapshot(), emptyDraft());
    } finally {
      console.error = original;
    }
  });

  it('continua funcionando em memória se o storage falhar ao gravar', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const original = console.warn;
    console.warn = () => undefined;
    try {
      const store = makeStore(storage);
      add(store, 'A');
      assert.equal(store.getSnapshot().exercises.length, 1);
    } finally {
      console.warn = original;
    }
  });

  it('funciona sem storage (SSR / acesso bloqueado)', () => {
    const store = makeStore(null);
    add(store, 'A');
    assert.equal(store.getSnapshot().exercises.length, 1);
  });

  it('refreshFromStorage reflete alteração feita por outra aba', () => {
    const storage = new MemoryStorage();
    const tabA = makeStore(storage);
    const tabB = makeStore(storage);
    tabA.getSnapshot();
    tabB.getSnapshot();
    add(tabB, 'B');
    assert.equal(tabA.getSnapshot().exercises.length, 0);
    tabA.refreshFromStorage();
    assert.deepEqual(tabA.getSnapshot().exercises.map((e) => e.name), ['B']);
  });
});
