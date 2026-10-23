'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPersistedStore, type PersistedStore } from './persisted-store';
import { parseStoredSession, touchSession, type LiveSession } from './session';
import { getBrowserStorage, getBrowserUserKey, makeUid } from './use-workout-draft';

export const liveSessionKey = (userKey: string) => `fittrack:live-session:v1:${userKey}`;

/** Sessão de treino em andamento (no celular, até ser finalizada). */
export const liveStore: PersistedStore<LiveSession | null> = createPersistedStore<LiveSession | null>({
  storage: getBrowserStorage(),
  getUserKey: getBrowserUserKey,
  keyFor: liveSessionKey,
  empty: null,
  isEmpty: (value) => value === null,
  parse: (raw) => parseStoredSession(raw, makeUid),
});

/**
 * Aplica uma alteração feita pelo usuário na sessão em andamento: grava no aparelho na hora
 * e marca a sessão como pendente de sincronização com o servidor.
 */
export function editLive(change: (session: LiveSession) => LiveSession): void {
  liveStore.update((current) => (current ? touchSession(current, change(current), Date.now()) : current));
}

function subscribe(listener: () => void): () => void {
  const unsubscribe = liveStore.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === liveSessionKey(getBrowserUserKey())) liveStore.refreshFromStorage();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener('storage', onStorage);
  };
}

export function useLiveSession(): LiveSession | null {
  return useSyncExternalStore(subscribe, liveStore.getSnapshot, liveStore.getServerSnapshot);
}

/** Relógio que atualiza a cada `intervalMs` e ao voltar para a aba (tela desbloqueada). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
  return now;
}
