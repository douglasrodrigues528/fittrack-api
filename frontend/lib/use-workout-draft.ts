'use client';

import { useSyncExternalStore } from 'react';
import { createDraftStore, draftStorageKey, type DraftStore } from './draft-store';
import type { UidFactory, WorkoutDraft } from './workout-draft';

export const TOKEN_KEY = 'token';

let uidCounter = 0;

export const makeUid: UidFactory = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  uidCounter += 1;
  return `ex-${Date.now().toString(36)}-${uidCounter}-${Math.random().toString(36).slice(2, 8)}`;
};

/** Lê o `sub` do JWT só para separar rascunhos por usuário (não é verificação de segurança). */
function userKeyFromToken(token: string | null): string {
  if (!token) return 'anon';
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      sub?: unknown;
    };
    return typeof json.sub === 'string' && json.sub ? json.sub : 'anon';
  } catch {
    return 'anon';
  }
}

let cachedToken: string | null | undefined;
let cachedUserKey = 'anon';

function currentUserKey(): string {
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (token !== cachedToken) {
    cachedToken = token;
    cachedUserKey = userKeyFromToken(token);
  }
  return cachedUserKey;
}

export function getBrowserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // acesso ao storage bloqueado
  }
}

/** Identificador do usuário atual (para separar dados locais por conta). */
export function getBrowserUserKey(): string {
  return getBrowserStorage() ? currentUserKey() : 'anon';
}

function createBrowserStore(): DraftStore {
  return createDraftStore({
    storage: getBrowserStorage(),
    getUserKey: getBrowserUserKey,
    makeUid,
  });
}

export const draftStore: DraftStore = createBrowserStore();

function subscribe(listener: () => void): () => void {
  const unsubscribe = draftStore.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    // Outra aba mexeu no rascunho do usuário atual (ou limpou o storage).
    if (event.key === null || event.key === draftStorageKey(currentUserKey())) {
      draftStore.refreshFromStorage();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener('storage', onStorage);
  };
}

/** Rascunho atual de treino, compartilhado entre dashboard e catálogo. */
export function useWorkoutDraft(): WorkoutDraft {
  return useSyncExternalStore(subscribe, draftStore.getSnapshot, draftStore.getServerSnapshot);
}
