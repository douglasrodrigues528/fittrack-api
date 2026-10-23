import {
  emptyDraft,
  isDraftEmpty,
  parseStoredDraft,
  type UidFactory,
  type WorkoutDraft,
} from './workout-draft';

/** Subconjunto de Storage usado aqui (permite testar sem navegador). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftStoreOptions {
  storage: StorageLike | null;
  /** Identifica o usuário atual; o rascunho é guardado separadamente por usuário. */
  getUserKey: () => string;
  makeUid: UidFactory;
}

export const LEGACY_DRAFT_KEY = 'fittrack:workout-draft';
const LEGACY_MAILBOX_KEYS = ['fittrack:selected-exercise', 'fittrack:queued-exercises'];

export function draftStorageKey(userKey: string): string {
  return `fittrack:workout-draft:v2:${userKey}`;
}

/**
 * Fonte única de verdade do rascunho de treino. Dashboard e catálogo leem e
 * escrevem aqui; cada alteração é gravada no storage de forma síncrona, então
 * nada se perde ao navegar, recarregar a página ou abrir outra aba.
 */
export function createDraftStore(options: DraftStoreOptions) {
  const { storage, getUserKey, makeUid } = options;
  const listeners = new Set<() => void>();
  const serverSnapshot = emptyDraft();
  let loadedFor: string | null = null;
  let snapshot: WorkoutDraft = serverSnapshot;

  function readFrom(key: string): WorkoutDraft | null {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      return parseStoredDraft(JSON.parse(raw) as unknown, makeUid);
    } catch (error) {
      console.error('Não foi possível restaurar o rascunho do treino.', error);
      return null;
    }
  }

  function write(userKey: string, draft: WorkoutDraft): void {
    if (!storage) return;
    try {
      if (isDraftEmpty(draft)) storage.removeItem(draftStorageKey(userKey));
      else storage.setItem(draftStorageKey(userKey), JSON.stringify(draft));
    } catch (error) {
      // Cota cheia / modo privado: o rascunho continua na memória desta aba.
      console.warn('Não foi possível gravar o rascunho do treino no navegador.', error);
    }
  }

  function load(): void {
    const userKey = getUserKey();
    if (loadedFor === userKey) return;
    loadedFor = userKey;

    let draft = readFrom(draftStorageKey(userKey));
    if (draft === null) {
      // Migra o rascunho do formato antigo (chave única, sem separação por usuário).
      const legacy = readFrom(LEGACY_DRAFT_KEY);
      if (legacy && !isDraftEmpty(legacy)) {
        draft = legacy;
        write(userKey, legacy);
      }
    }
    if (storage) {
      try {
        storage.removeItem(LEGACY_DRAFT_KEY);
        for (const key of LEGACY_MAILBOX_KEYS) storage.removeItem(key);
      } catch {
        /* ignora */
      }
    }
    snapshot = draft ?? emptyDraft();
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function update(change: (draft: WorkoutDraft) => WorkoutDraft): void {
    load();
    const next = change(snapshot);
    if (next === snapshot) return;
    snapshot = next;
    write(loadedFor ?? getUserKey(), next);
    notify();
  }

  return {
    getSnapshot(): WorkoutDraft {
      load();
      return snapshot;
    },

    getServerSnapshot(): WorkoutDraft {
      return serverSnapshot;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Aplica uma transformação pura ao rascunho atual, grava e avisa os componentes. */
    update,

    /** Descarta o rascunho. Só deve ser chamado após salvar com sucesso ou cancelar. */
    clear(): void {
      update(() => emptyDraft());
    },

    /** Relê do storage (ex.: alteração feita em outra aba). */
    refreshFromStorage(): void {
      loadedFor = null;
      load();
      notify();
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;
