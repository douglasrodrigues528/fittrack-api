'use client';

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { editLive, liveStore, useLiveSession, useNow } from '../../lib/use-live-session';
import {
  adoptServerSession,
  beginLiveSession,
  discardLiveSession,
  finishLiveSession,
  keepLocalAndDiscardOther,
  retrySync,
  saveClosedAsNew,
  useSyncState,
  type SyncState,
} from '../../lib/session-sync';
import { makeUid, TOKEN_KEY } from '../../lib/use-workout-draft';
import { api } from '../../services/api';
import LoadSuggestionCard from '../../components/LoadSuggestionCard';
import TrainStart from '../../components/TrainStart';
import {
  applySuggestion,
  performanceByExercise,
  revertSuggestion,
  suggestLoad,
} from '../../lib/load-suggestion';
import {
  SET_TYPE_LABEL,
  addExerciseByName,
  addLiveSet,
  adjustRest,
  formatClock,
  formatPrevious,
  hasPendingSync,
  moveLiveExercise,
  removeLiveExercise,
  removeLiveSet,
  restoreLiveSet,
  restRemainingSeconds,
  sessionStats,
  setRestDuration,
  skipRest,
  startEmptySession,
  toggleSetDone,
  updateLiveSet,
  validateFinish,
  type ExercisePerformance,
  type LiveSet,
  type SetType,
} from '../../lib/session';
import styles from './train.module.css';

const TYPE_LETTER: Record<SetType, string> = { warmup: 'A', normal: '', drop: 'D', failure: 'F' };

/** Por quanto tempo a remoção de uma série pode ser desfeita. */
const UNDO_REMOVE_MS = 8000;

/** Série removida que ainda pode voltar: a própria série e a posição em que estava. */
interface RemovedSet {
  exerciseUid: string;
  set: LiveSet;
  index: number;
  /** Identifica cada remoção (uma nova substitui a anterior e reinicia o prazo). */
  key: number;
}

/** Sugestões de carga dispensadas ("Manter"), por exercício da sessão (o uid é único). */
const DISMISSED_KEY = 'fittrack:load-suggestion-dismissed';

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(uids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(uids.slice(-200)));
  } catch {
    /* sem armazenamento: a sugestão só volta a aparecer */
  }
}

/** Opções da lista de tipo de série (o valor gravado continua sendo o mesmo de antes). */
const TYPE_OPTION_LABEL: Record<SetType, string> = {
  normal: 'Normal',
  warmup: 'Aquecimento (não conta no volume)',
  drop: 'Drop set',
  failure: 'Falha',
};

/** Ordem da lista: o tipo mais comum primeiro (os valores gravados são os mesmos de SET_TYPES). */
const TYPE_OPTIONS: SetType[] = ['normal', 'warmup', 'drop', 'failure'];

/** Passo dos botões de ajuste do descanso, em segundos. */
const REST_STEP = 15;

function selectOnFocus(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.select();
}

/** Texto curto do estado de salvamento exibido no cabeçalho do treino. */
function syncLabel(sync: SyncState, pending: boolean): string {
  switch (sync.kind) {
    case 'saving':
      return 'Salvando…';
    case 'offline':
      return 'Sem conexão · salvo neste aparelho';
    case 'conflict':
    case 'closed':
    case 'error':
      return 'Não sincronizado · salvo neste aparelho';
    default:
      return pending ? 'Salvando…' : 'Salvo na sua conta ✓';
  }
}

export default function TrainPage() {
  const router = useRouter();
  const session = useLiveSession();
  const sync = useSyncState();
  const active = session !== null;
  const now = useNow(1000, active);
  const pending = session !== null && hasPendingSync(session);

  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [newExercise, setNewExercise] = useState('');
  const [removedSet, setRemovedSet] = useState<RemovedSet | null>(null);
  // Só a exibição: o cronômetro continua na sessão (restEndsAt) e segue correndo minimizado.
  const [restMinimized, setRestMinimized] = useState(false);
  const [restConfigOpen, setRestConfigOpen] = useState(false);
  const undoRef = useRef<HTMLButtonElement>(null);

  // O aviso de desfazer some sozinho; a remoção já está salva desde o toque.
  useEffect(() => {
    if (!removedSet) return;
    const timer = window.setTimeout(() => setRemovedSet(null), UNDO_REMOVE_MS);
    return () => window.clearTimeout(timer);
  }, [removedSet]);

  // O botão removido levava o foco; ele passa para "Desfazer" (teclado e leitor de tela não se perdem).
  useEffect(() => {
    if (removedSet) undoRef.current?.focus({ preventScroll: true });
  }, [removedSet]);

  function handleRemoveSet(exerciseUid: string, setUid: string) {
    const current = liveStore.getSnapshot();
    const exercise = current?.exercises.find((item) => item.uid === exerciseUid);
    const index = exercise ? exercise.sets.findIndex((item) => item.uid === setUid) : -1;
    if (!exercise || index < 0) return;
    editLive((c) => removeLiveSet(c, exerciseUid, setUid));
    setRemovedSet({ exerciseUid, set: exercise.sets[index], index, key: Date.now() });
  }

  function handleUndoRemove() {
    if (!removedSet) return;
    const { exerciseUid, set, index } = removedSet;
    editLive((c) => restoreLiveSet(c, exerciseUid, set, index));
    setRemovedSet(null);
  }
  // Referência da rotina (a mesma usada ao iniciar): objetivo planejado + último treino concluído.
  const [reference, setReference] = useState<{ workoutId: string; exercises: ExercisePerformance[] } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readDismissed()));
  const workoutId = session?.origin === 'planned' ? session.workoutId : null;

  // Só leitura: buscar a referência não altera a sessão, a rotina nem o histórico.
  useEffect(() => {
    if (!workoutId) return;
    let cancelled = false;
    api
      .get<{ exercises: ExercisePerformance[] }>(`/sessions/last-performance/${workoutId}`)
      .then((response) => {
        if (!cancelled) setReference({ workoutId, exercises: response.data.exercises ?? [] });
      })
      .catch((error: unknown) => {
        // Sem referência (sem conexão, rotina excluída...): simplesmente não há sugestão.
        console.warn('Sugestões de carga indisponíveis.', error);
      });
    return () => {
      cancelled = true;
    };
  }, [workoutId]);

  const references =
    session && reference && reference.workoutId === workoutId
      ? performanceByExercise(session.exercises, reference.exercises)
      : new Map<string, ExercisePerformance>();

  function dismissSuggestion(exerciseUid: string) {
    const next = [...dismissed.filter((uid) => uid !== exerciseUid), exerciseUid];
    setDismissed(next);
    writeDismissed(next);
  }

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) router.replace('/');
  }, [router]);

  // Mantém a tela ligada durante o treino (quando o navegador permite).
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        /* sem permissão ou sem suporte: segue sem */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);

  // Avisa antes de fechar/recarregar se ainda há alterações que não chegaram ao servidor.
  // (A cópia no aparelho continua guardada; o aviso evita surpresa ao trocar de aparelho.)
  useEffect(() => {
    if (!pending) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pending]);

  const restLeft = session ? restRemainingSeconds(session, now) : 0;
  const restExpired = session?.restEndsAt != null && restLeft === 0;

  // Fim do descanso: avisa com vibração (se houver) e limpa o cronômetro.
  useEffect(() => {
    if (!restExpired) return;
    try {
      navigator.vibrate?.([250, 120, 250]);
    } catch {
      /* ignora */
    }
    liveStore.update((current) => (current ? skipRest(current) : current));
  }, [restExpired]);

  function startFree() {
    beginLiveSession(startEmptySession(makeUid, new Date().toISOString()));
    setMessage('');
  }

  function handleToggle(exerciseUid: string, setUid: string) {
    const current = liveStore.getSnapshot();
    if (!current) return;
    const result = toggleSetDone(current, exerciseUid, setUid, Date.now());
    if ('error' in result) {
      setMessage(result.error);
      return;
    }
    setMessage('');
    editLive(() => result);
  }

  function handleAddExercise() {
    const current = liveStore.getSnapshot();
    if (!current) return;
    const result = addExerciseByName(current, newExercise, makeUid);
    if ('error' in result) {
      setMessage(result.error);
      return;
    }
    setMessage('');
    setNewExercise('');
    editLive(() => result);
  }

  function handleExerciseKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddExercise();
    }
  }

  function handleDiscard() {
    if (window.confirm('Descartar este treino? As séries registradas serão perdidas.')) {
      void discardLiveSession();
      setMessage('');
    }
  }

  async function handleFinish() {
    const current = liveStore.getSnapshot();
    if (!current || saving) return;

    const problem = validateFinish(current);
    if (problem) {
      setMessage(problem);
      return;
    }
    const { pendingSets } = sessionStats(current);
    if (
      pendingSets > 0 &&
      !window.confirm(`${pendingSets} série(s) não concluída(s) serão descartadas. Finalizar o treino mesmo assim?`)
    ) {
      return;
    }

    setSaving(true);
    setMessage('');
    // Só apaga o treino do aparelho depois que a API confirmou.
    const result = await finishLiveSession();
    setSaving(false);
    if (result.ok) router.replace('/history?concluido=1');
    else setMessage(result.message);
  }

  if (!session) {
    return <TrainStart onStartFree={startFree} />;
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const stats = sessionStats(session);

  function renderSet(exerciseUid: string, set: LiveSet, index: number, previousText: string) {
    return (
      <div key={set.uid} className={`${styles.setRow} ${set.done ? styles.setDone : ''}`}>
        <span className={`${styles.typePick} ${styles[`type_${set.type}`]}`}>
          <span aria-hidden="true">
            {TYPE_LETTER[set.type] || index + 1}
            <span className={styles.typeCaret}>▾</span>
          </span>
          <select
            className={styles.typeSelect}
            aria-label={`Tipo da série ${index + 1}`}
            value={set.type}
            onChange={(e) =>
              editLive((c) => updateLiveSet(c, exerciseUid, set.uid, { type: e.target.value as SetType }))
            }
          >
            {TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {TYPE_OPTION_LABEL[type]}
              </option>
            ))}
          </select>
        </span>
        <span className={styles.prev}>
          {previousText}
          {set.type !== 'normal' && <span className={styles.typeName}> · {SET_TYPE_LABEL[set.type]}</span>}
        </span>
        <input
          className={styles.field}
          aria-label={`Peso da série ${index + 1} (kg)`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          placeholder="kg"
          value={set.weight}
          onFocus={selectOnFocus}
          onChange={(e) =>
            editLive((c) => updateLiveSet(c, exerciseUid, set.uid, { weight: e.target.value }))
          }
        />
        <input
          className={styles.field}
          aria-label={`Repetições da série ${index + 1}`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          placeholder="reps"
          value={set.reps}
          onFocus={selectOnFocus}
          onChange={(e) =>
            editLive((c) => updateLiveSet(c, exerciseUid, set.uid, { reps: e.target.value }))
          }
        />
        <button
          type="button"
          className={`${styles.check} ${set.done ? styles.checkOn : ''}`}
          aria-label={set.done ? `Desmarcar série ${index + 1}` : `Concluir série ${index + 1}`}
          aria-pressed={set.done}
          onClick={() => handleToggle(exerciseUid, set.uid)}
        >
          ✓
        </button>
        <button
          type="button"
          className={styles.removeSet}
          aria-label={`Remover série ${index + 1}`}
          onClick={() => handleRemoveSet(exerciseUid, set.uid)}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <input
            className={styles.titleInput}
            aria-label="Nome do treino"
            value={session.title}
            onChange={(e) => editLive((c) => ({ ...c, title: e.target.value }))}
          />
          <button type="button" className={styles.finish} onClick={handleFinish} disabled={saving}>
            {saving ? 'Salvando…' : 'Finalizar'}
          </button>
        </div>
        {restLeft > 0 && !restMinimized ? (
          // Descanso ativo: o mesmo cronômetro de sempre (restEndsAt), agora na 2ª linha do cabeçalho.
          <div className={styles.restRow} role="timer" aria-live="off" aria-label="Descanso">
            <span className={styles.restClock}>
              <span className={styles.chipLabel}>Descanso</span>
              <strong>{formatClock(restLeft)}</strong>
            </span>
            <button
              type="button"
              className={styles.restBtn}
              aria-label={`Diminuir ${REST_STEP} segundos`}
              onClick={() => liveStore.update((c) => (c ? adjustRest(c, -REST_STEP, Date.now()) : c))}
            >
              −15s
            </button>
            <button
              type="button"
              className={styles.restBtn}
              aria-label={`Aumentar ${REST_STEP} segundos`}
              onClick={() => liveStore.update((c) => (c ? adjustRest(c, REST_STEP, Date.now()) : c))}
            >
              +15s
            </button>
            <button type="button" className={styles.restBtn} onClick={() => liveStore.update((c) => (c ? skipRest(c) : c))}>
              Pular
            </button>
            {/* O status de salvamento continua anunciado enquanto a linha mostra o descanso. */}
            <span className={styles.srOnly} role="status" aria-live="polite">
              {syncLabel(sync, pending)}
            </span>
            <button
              type="button"
              className={styles.restBtn}
              aria-label="Ocultar controles do descanso (o tempo continua contando)"
              aria-expanded="true"
              onClick={() => setRestMinimized(true)}
            >
              Ocultar
            </button>
          </div>
        ) : (
          <div className={styles.headerBar}>
            <div className={styles.summary}>
              <p className={styles.metrics}>
                <span className={styles.srOnly}>Duração </span>
                {formatClock(elapsed)}
                <span className={styles.sep} aria-hidden="true">·</span>
                <span className={styles.srOnly}>, volume </span>
                {Math.round(stats.volume).toLocaleString('pt-BR')} kg
                <span className={styles.sep} aria-hidden="true">·</span>
                <span className={styles.srOnly}>, </span>
                {stats.doneSets}/{stats.totalSets} séries
              </p>
              <p className={styles.syncLine} role="status" aria-live="polite">
                {syncLabel(sync, pending)}
              </p>
            </div>
            {restLeft > 0 ? (
              <button
                type="button"
                className={`${styles.restChip} ${styles.restChipActive}`}
                aria-label={`Descanso: ${formatClock(restLeft)} restantes. Mostrar controles`}
                aria-expanded="false"
                onClick={() => setRestMinimized(false)}
              >
                <span className={styles.chipLabel}>Descanso</span>
                <span className={styles.chipValue}>{formatClock(restLeft)}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.restChip}
                aria-expanded={restConfigOpen}
                aria-controls="rest-config"
                onClick={() => setRestConfigOpen((open) => !open)}
              >
                <span className={styles.chipLabel}>Descanso</span>
                <span className={styles.chipValue}>{session.restSeconds} s</span>
              </button>
            )}
          </div>
        )}
        {restConfigOpen && restLeft === 0 && (
          <div id="rest-config" className={styles.restConfig} role="group" aria-label="Tempo de descanso entre séries">
            <span>Descanso entre séries</span>
            <button
              type="button"
              className={styles.restBtn}
              aria-label={`Diminuir ${REST_STEP} segundos`}
              disabled={session.restSeconds <= 10}
              onClick={() => editLive((c) => setRestDuration(c, c.restSeconds - REST_STEP))}
            >
              −15s
            </button>
            <output aria-live="polite">{session.restSeconds} s</output>
            <button
              type="button"
              className={styles.restBtn}
              aria-label={`Aumentar ${REST_STEP} segundos`}
              disabled={session.restSeconds >= 600}
              onClick={() => editLive((c) => setRestDuration(c, c.restSeconds + REST_STEP))}
            >
              +15s
            </button>
            <button type="button" className={styles.restBtn} onClick={() => setRestConfigOpen(false)}>
              OK
            </button>
          </div>
        )}
      </header>

      {sync.kind === 'conflict' && (
        <div className={styles.notice} role="alert">
          <p>
            Já existe outro treino em andamento na sua conta: <strong>{sync.other.title}</strong> (iniciado às{' '}
            {new Date(sync.other.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}).
            Qual deles você quer manter?
          </p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.secondary} onClick={() => adoptServerSession(sync.other)}>
              Continuar o outro treino
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (window.confirm(`Descartar "${sync.other.title}" e manter o treino desta tela?`)) {
                  void keepLocalAndDiscardOther(sync.other);
                }
              }}
            >
              Manter este treino
            </button>
          </div>
        </div>
      )}

      {sync.kind === 'closed' && (
        <div className={styles.notice} role="alert">
          <p>Este treino foi finalizado ou descartado em outro aparelho. O que está nesta tela não foi perdido.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.secondary} onClick={() => void saveClosedAsNew()}>
              Salvar como novo treino
            </button>
            <button type="button" className={styles.danger} onClick={handleDiscard}>
              Descartar esta cópia
            </button>
          </div>
        </div>
      )}

      {sync.kind === 'error' && (
        <div className={styles.notice} role="alert">
          <p>{sync.message} Seu treino continua salvo neste aparelho.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.secondary} onClick={retrySync}>
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={styles.message} role="alert">
          {message}
        </div>
      )}

      {session.exercises.length === 0 && (
        <div className={styles.card}>
          <h2>Comece adicionando um exercício</h2>
          <p className={styles.legend}>
            Procure no catálogo (com imagens e instruções) ou digite o nome abaixo. Depois registre peso e repetições
            de cada série.
          </p>
          <Link href="/exercises?destino=treino" className={styles.primary}>
            📚 Escolher exercícios no catálogo
          </Link>
        </div>
      )}

      {session.exercises.map((exercise, exerciseIndex) => (
        <section key={exercise.uid} className={styles.exercise}>
          <div className={styles.exerciseHead}>
            <h2>{exercise.name}</h2>
            <div className={styles.exerciseTools}>
              <button
                type="button"
                className={styles.moveEx}
                aria-label={`Mover ${exercise.name} para cima`}
                disabled={exerciseIndex === 0}
                onClick={() => editLive((c) => moveLiveExercise(c, exercise.uid, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.moveEx}
                aria-label={`Mover ${exercise.name} para baixo`}
                disabled={exerciseIndex === session.exercises.length - 1}
                onClick={() => editLive((c) => moveLiveExercise(c, exercise.uid, 1))}
              >
                ↓
              </button>
            <button
              type="button"
              className={styles.removeEx}
              aria-label={`Remover ${exercise.name} do treino`}
              onClick={() => {
                if (window.confirm(`Remover "${exercise.name}" deste treino?`)) {
                  editLive((c) => removeLiveExercise(c, exercise.uid));
                }
              }}
            >
              Remover
            </button>
            </div>
          </div>

          {(() => {
            const suggestion = dismissed.includes(exercise.uid) ? null : suggestLoad(references.get(exercise.uid));
            if (!suggestion) return null;
            return (
              <LoadSuggestionCard
                exercise={exercise}
                suggestion={suggestion}
                onApply={() =>
                  suggestion.kind === 'increase' && editLive((c) => applySuggestion(c, exercise.uid, suggestion))
                }
                onUndo={() =>
                  suggestion.kind === 'increase' && editLive((c) => revertSuggestion(c, exercise.uid, suggestion))
                }
                onDismiss={() => dismissSuggestion(exercise.uid)}
              />
            );
          })()}

          <div className={styles.colHead}>
            <span>Série</span>
            <span>Anterior</span>
            <span>kg</span>
            <span>Reps</span>
            <span />
            <span />
          </div>

          {(() => {
            const rows = exercise.sets.map((set, index) =>
              renderSet(exercise.uid, set, index, formatPrevious(exercise.previous[index])),
            );
            // A série removida dá lugar, na mesma posição, a um aviso discreto com "Desfazer".
            if (removedSet && removedSet.exerciseUid === exercise.uid) {
              rows.splice(
                Math.min(removedSet.index, rows.length),
                0,
                <div key={`removida-${removedSet.key}`} className={styles.undoRow} role="status">
                  <span>Série {removedSet.index + 1} removida</span>
                  <button ref={undoRef} type="button" className={styles.undoBtn} onClick={handleUndoRemove}>
                    Desfazer
                  </button>
                </div>,
              );
            }
            return rows;
          })()}

          <button
            type="button"
            className={styles.addSet}
            onClick={() => editLive((c) => addLiveSet(c, exercise.uid, makeUid))}
          >
            + Adicionar série
          </button>
        </section>
      ))}

      <section className={styles.card}>
        <h2>Adicionar exercício</h2>
        {session.exercises.length > 0 && (
          <Link href="/exercises?destino=treino" className={styles.primary}>
            📚 Buscar no catálogo
          </Link>
        )}
        <div className={styles.addRow}>
          <input
            className={styles.textInput}
            aria-label="Nome do exercício"
            placeholder="Ou digite o nome do exercício"
            value={newExercise}
            onChange={(e) => setNewExercise(e.target.value)}
            onKeyDown={handleExerciseKey}
          />
          <button type="button" className={styles.secondary} onClick={handleAddExercise}>
            Adicionar
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Notas</h2>
        <textarea
          className={styles.textInput}
          aria-label="Notas do treino"
          placeholder="Como foi o treino?"
          value={session.notes}
          onChange={(e) => editLive((c) => ({ ...c, notes: e.target.value }))}
        />
        <button type="button" className={styles.danger} onClick={handleDiscard}>
          Descartar treino
        </button>
      </section>

    </div>
  );
}
