'use client';

/**
 * Sincronização da sessão em andamento com a API.
 *
 * - Cada toque é gravado primeiro no aparelho (liveStore → localStorage), então nada se perde
 *   ao navegar, recarregar ou ficar sem sinal.
 * - Em seguida (com um pequeno atraso para agrupar toques) o estado é enviado ao servidor:
 *   POST /sessions/start na primeira vez e PUT /sessions/:id/progress depois.
 * - Sem conexão, a sessão continua no aparelho e o envio é repetido ao voltar a conexão.
 * - Ao abrir o app sem sessão local, a sessão em andamento do servidor é recuperada.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { isAxiosError } from 'axios';
import { api } from '../services/api';
import {
  hasPendingSync,
  sessionFromServer,
  toFinishPayload,
  toProgressPayload,
  type LiveSession,
  type ServerActiveSession,
} from './session';
import { liveStore } from './use-live-session';
import { getBrowserStorage, getBrowserUserKey, makeUid, TOKEN_KEY } from './use-workout-draft';

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** Sem conexão (ou servidor fora do ar): salvo só no aparelho, nova tentativa automática. */
  | { kind: 'offline' }
  /** Já existe OUTRA sessão em andamento na conta (aberta em outro aparelho). */
  | { kind: 'conflict'; other: ServerActiveSession }
  /** A sessão foi finalizada ou descartada em outro lugar. */
  | { kind: 'closed' }
  | { kind: 'error'; message: string };

/* ------------------------------ estado da sincronização ------------------------------ */

let state: SyncState = { kind: 'idle' };
const listeners = new Set<() => void>();

function setState(next: SyncState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

const subscribeState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const IDLE: SyncState = { kind: 'idle' };

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeState, () => state, () => IDLE);
}

/* --------------------------------- utilitários --------------------------------- */

function serverMessage(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const message: unknown = error.response?.data?.message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' && message ? message : null;
}

/** Sem resposta ou erro 5xx: vale tentar de novo mais tarde. */
function isTransient(error: unknown): boolean {
  if (!isAxiosError(error)) return true;
  const status = error.response?.status;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

function conflictSession(error: unknown): ServerActiveSession | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as { code?: string; activeSession?: ServerActiveSession } | undefined;
  return data?.code === 'SESSION_IN_PROGRESS' && data.activeSession ? data.activeSession : null;
}

/** Aplica o resultado de um envio só se a sessão local ainda for a mesma. */
function updateIfSame(localId: string, change: (session: LiveSession) => LiveSession): void {
  liveStore.update((current) => (current && current.localId === localId ? change(current) : current));
}

/* ------------------------ descartes pendentes (feitos sem conexão) ------------------------ */

const pendingCancelKey = (userKey: string) => `fittrack:pending-cancel:v1:${userKey}`;

function readPendingCancels(): string[] {
  const storage = getBrowserStorage();
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(pendingCancelKey(getBrowserUserKey())) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writePendingCancels(ids: string[]): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    const key = pendingCancelKey(getBrowserUserKey());
    if (ids.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignora: no pior caso a sessão reaparece e pode ser descartada de novo */
  }
}

async function flushPendingCancels(): Promise<void> {
  const pending = readPendingCancels();
  if (pending.length === 0) return;
  const remaining: string[] = [];
  for (const id of pending) {
    try {
      await api.post(`/sessions/${id}/cancel`);
    } catch (error) {
      if (isTransient(error)) remaining.push(id);
    }
  }
  writePendingCancels(remaining);
}

/* ---------------------------------- sincronização ---------------------------------- */

let running: Promise<void> | null = null;
let runAgain = false;

async function syncOnce(): Promise<void> {
  await flushPendingCancels();

  const session = liveStore.getSnapshot();
  if (!session) {
    if (state.kind !== 'conflict') setState(IDLE);
    return;
  }
  // Aguardando decisão do usuário: não envia nada automaticamente.
  if (state.kind === 'conflict' || state.kind === 'closed') return;
  if (!hasPendingSync(session)) {
    if (state.kind !== 'saved') setState({ kind: 'saved', at: Date.now() });
    return;
  }

  setState({ kind: 'saving' });
  const sentAt = session.updatedAt;

  try {
    if (!session.serverId) {
      const response = await api.post<{ id: string }>('/sessions/start', {
        ...(session.workoutId ? { workoutId: session.workoutId } : {}),
        startedAt: session.startedAt,
        progress: toProgressPayload(session),
      });
      updateIfSame(session.localId, (current) => ({ ...current, serverId: response.data.id, syncedAt: sentAt }));
    } else {
      await api.put(`/sessions/${session.serverId}/progress`, { progress: toProgressPayload(session) });
      updateIfSame(session.localId, (current) => ({ ...current, syncedAt: sentAt }));
    }
    setState({ kind: 'saved', at: Date.now() });
  } catch (error) {
    const other = conflictSession(error);
    if (other) {
      // A mesma sessão, criada por outra aba deste aparelho: só adota o ID.
      if (Date.parse(other.startedAt) === Date.parse(session.startedAt)) {
        updateIfSame(session.localId, (current) => ({ ...current, serverId: other.id }));
        runAgain = true;
        return;
      }
      setState({ kind: 'conflict', other });
      return;
    }
    if (isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 409)) {
      setState({ kind: 'closed' });
      return;
    }
    if (isTransient(error)) {
      setState({ kind: 'offline' });
      return;
    }
    console.error(error);
    setState({ kind: 'error', message: serverMessage(error) ?? 'Não foi possível salvar o treino no servidor.' });
  }
}

/** Envia o estado atual ao servidor (uma execução por vez; pedidos durante o envio são agrupados). */
export function syncNow(): Promise<void> {
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        runAgain = false;
        await syncOnce();
      } while (runAgain);
    } finally {
      running = null;
    }
  })();
  return running;
}

let hydratedFor: string | null = null;

/** Ao abrir o app: recupera a sessão em andamento do servidor ou detecta divergências. */
async function hydrateFromServer(): Promise<void> {
  const userKey = getBrowserUserKey();
  if (hydratedFor === userKey) return;
  hydratedFor = userKey;

  let server: ServerActiveSession | null;
  try {
    const response = await api.get<{ session: ServerActiveSession | null }>('/sessions/active');
    server = response.data?.session ?? null;
  } catch {
    hydratedFor = null; // tenta de novo na próxima oportunidade
    return;
  }
  if (server && readPendingCancels().includes(server.id)) server = null;

  const local = liveStore.getSnapshot();
  if (!local) {
    if (server) {
      liveStore.set(sessionFromServer(server, makeUid, Date.now()));
      setState({ kind: 'saved', at: Date.now() });
    }
    return;
  }
  if (local.serverId) {
    if (server?.id === local.serverId) return;
    setState(server ? { kind: 'conflict', other: server } : { kind: 'closed' });
    return;
  }
  if (server && Date.parse(server.startedAt) !== Date.parse(local.startedAt)) {
    setState({ kind: 'conflict', other: server });
  }
}

/* ------------------------------------ ações ------------------------------------ */

/** Começa uma sessão (já gravada no aparelho) e a registra no servidor. */
export function beginLiveSession(session: LiveSession): void {
  liveStore.set(session);
  setState({ kind: 'saving' });
  void syncNow();
}

/** Descarta a sessão em andamento. Sem conexão, o descarte no servidor fica agendado. */
export async function discardLiveSession(): Promise<void> {
  const session = liveStore.getSnapshot();
  liveStore.clear();
  setState(IDLE);
  if (!session?.serverId) return;
  try {
    await api.post(`/sessions/${session.serverId}/cancel`);
  } catch (error) {
    if (isTransient(error)) writePendingCancels([...readPendingCancels(), session.serverId]);
  }
}

export type FinishResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Conclui a sessão: envia só as séries realizadas. O treino só sai do aparelho depois
 * que a API confirma; repetir após falha não duplica nada (o servidor é idempotente).
 */
export async function finishLiveSession(): Promise<FinishResult> {
  let session = liveStore.getSnapshot();
  if (!session) return { ok: false, message: 'Nenhum treino em andamento.' };
  if (state.kind === 'closed') {
    // Finalizar a sessão antiga devolveria a versão já encerrada e apagaria o que está na tela.
    return {
      ok: false,
      message: 'Este treino já foi encerrado em outro aparelho. Use "Salvar como novo treino" para não perder esta tela.',
    };
  }

  if (!session.serverId) {
    await syncNow();
    session = liveStore.getSnapshot();
  }
  if (!session?.serverId) {
    const current = state;
    if (current.kind === 'conflict') {
      return { ok: false, message: 'Resolva o aviso de outro treino em andamento antes de finalizar.' };
    }
    if (current.kind === 'error') return { ok: false, message: current.message };
    return {
      ok: false,
      message: 'Sem conexão com o servidor. Seu treino continua salvo neste aparelho; tente finalizar novamente.',
    };
  }

  try {
    const response = await api.post<{ id: string }>(
      `/sessions/${session.serverId}/finish`,
      toFinishPayload(session, new Date().toISOString()),
    );
    liveStore.clear();
    setState(IDLE);
    return { ok: true, id: response.data.id };
  } catch (error) {
    console.error(error);
    if (isTransient(error)) {
      return {
        ok: false,
        message: 'Sem conexão com o servidor. Seu treino continua salvo neste aparelho; tente finalizar novamente.',
      };
    }
    return { ok: false, message: `Não foi possível finalizar: ${serverMessage(error) ?? 'erro desconhecido.'}` };
  }
}

/** Conflito: continuar o treino que já estava em andamento na conta (substitui a cópia local). */
export function adoptServerSession(other: ServerActiveSession): void {
  liveStore.set(sessionFromServer(other, makeUid, Date.now()));
  setState({ kind: 'saved', at: Date.now() });
}

/** Conflito: manter o treino deste aparelho e descartar o outro. */
export async function keepLocalAndDiscardOther(other: ServerActiveSession): Promise<void> {
  try {
    await api.post(`/sessions/${other.id}/cancel`);
  } catch (error) {
    if (isTransient(error)) {
      setState({ kind: 'offline' });
      return;
    }
  }
  liveStore.update((current) => (current ? { ...current, serverId: null } : current));
  setState(IDLE);
  await syncNow();
}

/** Sessão encerrada em outro lugar: salvar o que está na tela como um novo treino. */
export async function saveClosedAsNew(): Promise<void> {
  liveStore.update((current) => (current ? { ...current, serverId: null, syncedAt: null } : current));
  setState(IDLE);
  await syncNow();
}

export function retrySync(): void {
  if (state.kind === 'error' || state.kind === 'offline') setState(IDLE);
  void syncNow();
}

/* ------------------------------------- hook ------------------------------------- */

const DEBOUNCE_MS = 800;
const RETRY_MS = 15000;

/** Último envio ao fechar/ocultar a página (keepalive permite concluir após a navegação). */
function flushOnExit(): void {
  const session = liveStore.getSnapshot();
  const token = getBrowserStorage()?.getItem(TOKEN_KEY);
  if (!session?.serverId || !hasPendingSync(session) || !token) return;
  try {
    void fetch(`${api.defaults.baseURL ?? ''}/sessions/${session.serverId}/progress`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ progress: toProgressPayload(session) }),
    }).catch(() => undefined);
  } catch {
    /* a cópia local continua guardada */
  }
}

/** Mantém a sessão em andamento sincronizada. Montado uma vez no layout da área autenticada. */
export function useSessionSync(): void {
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void syncNow(), DEBOUNCE_MS);
    };

    void hydrateFromServer().then(() => syncNow());

    const unsubscribe = liveStore.subscribe(() => {
      const session = liveStore.getSnapshot();
      if (session && hasPendingSync(session)) schedule();
    });
    const onOnline = () => {
      if (state.kind === 'offline') setState(IDLE);
      void syncNow();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushOnExit();
    };
    const retry = window.setInterval(() => {
      const session = liveStore.getSnapshot();
      if ((session && hasPendingSync(session)) || readPendingCancels().length > 0) {
        if (state.kind === 'offline') setState(IDLE);
        void syncNow();
      }
    }, RETRY_MS);

    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(retry);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', flushOnExit);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);
}
