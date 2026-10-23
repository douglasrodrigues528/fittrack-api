import type { StorageLike } from './draft-store';

export interface PersistedStoreOptions<T> {
  storage: StorageLike | null;
  getUserKey: () => string;
  /** Chave de armazenamento para o usuário. */
  keyFor: (userKey: string) => string;
  /** Valor inicial e valor "vazio" (nada a persistir). */
  empty: T;
  isEmpty: (value: T) => boolean;
  /** Reconstrói o valor a partir do JSON salvo (ou null se inválido). */
  parse: (raw: unknown) => T | null;
}

/** Store genérico com persistência síncrona, por usuário, compatível com useSyncExternalStore. */
export function createPersistedStore<T>(options: PersistedStoreOptions<T>) {
  const { storage, getUserKey, keyFor, empty, isEmpty, parse } = options;
  const listeners = new Set<() => void>();
  let loadedFor: string | null = null;
  let snapshot: T = empty;

  function load(): void {
    const userKey = getUserKey();
    if (loadedFor === userKey) return;
    loadedFor = userKey;
    snapshot = empty;
    if (!storage) return;
    try {
      const raw = storage.getItem(keyFor(userKey));
      if (raw !== null) snapshot = parse(JSON.parse(raw) as unknown) ?? empty;
    } catch (error) {
      console.error('Não foi possível restaurar os dados salvos no navegador.', error);
    }
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function update(change: (value: T) => T): void {
    load();
    const next = change(snapshot);
    if (next === snapshot) return;
    snapshot = next;
    if (storage) {
      try {
        const key = keyFor(loadedFor ?? getUserKey());
        if (isEmpty(next)) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(next));
      } catch (error) {
        console.warn('Não foi possível gravar no navegador; os dados ficam só na memória desta aba.', error);
      }
    }
    notify();
  }

  return {
    getSnapshot(): T {
      load();
      return snapshot;
    },
    getServerSnapshot(): T {
      return empty;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    set(value: T): void {
      update(() => value);
    },
    clear(): void {
      update(() => empty);
    },
    refreshFromStorage(): void {
      loadedFor = null;
      load();
      notify();
    },
  };
}

export type PersistedStore<T> = ReturnType<typeof createPersistedStore<T>>;
