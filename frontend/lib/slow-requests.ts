/**
 * Requisições à API que estão demorando. No plano gratuito do Render a API dorme depois de
 * um tempo sem uso, e a primeira resposta pode levar até cerca de um minuto: a interface
 * usa isto para avisar que o servidor pode estar iniciando.
 */

/** A partir de quanto tempo uma requisição conta como lenta. */
export const SLOW_REQUEST_MS = 4000;

type Timer = ReturnType<typeof setTimeout>;

export interface SlowRequestTracker {
  /** Começa a acompanhar uma requisição; devolve o identificador para `end`. */
  start(): number;
  /** A requisição terminou (com sucesso ou erro). */
  end(id: number | undefined): void;
  /** Há alguma requisição lenta em andamento? */
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createSlowRequestTracker(
  delayMs = SLOW_REQUEST_MS,
  timers: { set: (fn: () => void, ms: number) => Timer; clear: (timer: Timer) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (timer) => clearTimeout(timer),
  },
): SlowRequestTracker {
  let nextId = 1;
  const pending = new Map<number, Timer>();
  const slow = new Set<number>();
  const listeners = new Set<() => void>();
  let snapshot = false;

  const update = () => {
    const next = slow.size > 0;
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    start() {
      const id = nextId++;
      pending.set(
        id,
        timers.set(() => {
          pending.delete(id);
          slow.add(id);
          update();
        }, delayMs),
      );
      return id;
    },
    end(id) {
      if (id === undefined) return;
      const timer = pending.get(id);
      if (timer !== undefined) {
        timers.clear(timer);
        pending.delete(id);
      }
      if (slow.delete(id)) update();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Rastreador único do app, alimentado pelo cliente da API (services/api.ts). */
export const slowRequests = createSlowRequestTracker();
