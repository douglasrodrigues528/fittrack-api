import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SLOW_REQUEST_MS, createSlowRequestTracker } from '../slow-requests';

/** Relógio manual: os timers só disparam quando o teste avança o tempo. */
function manualTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer as unknown as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

describe('requisições lentas (aviso de servidor iniciando)', () => {
  it('o aviso começa após 4 s', () => {
    assert.equal(SLOW_REQUEST_MS, 4000);
  });

  it('resposta rápida: o aviso nunca aparece e nenhum timer sobra', () => {
    const timers = manualTimers();
    const tracker = createSlowRequestTracker(4000, timers);
    const changes: boolean[] = [];
    tracker.subscribe(() => changes.push(tracker.getSnapshot()));
    const id = tracker.start();
    timers.advance(1500);
    tracker.end(id);
    timers.advance(10_000);
    assert.equal(tracker.getSnapshot(), false);
    assert.deepEqual(changes, []);
    assert.equal(timers.pending(), 0);
  });

  it('resposta lenta: aparece após o limite e some quando a resposta chega (sucesso ou erro)', () => {
    const timers = manualTimers();
    const tracker = createSlowRequestTracker(4000, timers);
    const changes: boolean[] = [];
    tracker.subscribe(() => changes.push(tracker.getSnapshot()));
    const id = tracker.start();
    timers.advance(3999);
    assert.equal(tracker.getSnapshot(), false);
    timers.advance(1);
    assert.equal(tracker.getSnapshot(), true);
    tracker.end(id);
    assert.equal(tracker.getSnapshot(), false);
    assert.deepEqual(changes, [true, false]);
  });

  it('várias requisições: o aviso fica até a última lenta terminar', () => {
    const timers = manualTimers();
    const tracker = createSlowRequestTracker(4000, timers);
    const a = tracker.start();
    const b = tracker.start();
    timers.advance(5000);
    tracker.end(a);
    assert.equal(tracker.getSnapshot(), true);
    tracker.end(b);
    assert.equal(tracker.getSnapshot(), false);
  });

  it('end com id ausente ou repetido não quebra nem mexe no estado', () => {
    const timers = manualTimers();
    const tracker = createSlowRequestTracker(4000, timers);
    tracker.end(undefined);
    const id = tracker.start();
    tracker.end(id);
    tracker.end(id);
    assert.equal(tracker.getSnapshot(), false);
  });

  it('cancelar a inscrição para de notificar', () => {
    const timers = manualTimers();
    const tracker = createSlowRequestTracker(4000, timers);
    let calls = 0;
    const unsubscribe = tracker.subscribe(() => calls++);
    unsubscribe();
    tracker.start();
    timers.advance(5000);
    assert.equal(calls, 0);
  });
});
