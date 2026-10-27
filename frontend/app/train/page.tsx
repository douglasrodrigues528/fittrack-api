'use client';

import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react';
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
import {
  applySuggestion,
  performanceByExercise,
  revertSuggestion,
  suggestLoad,
} from '../../lib/load-suggestion';
import {
  SET_TYPE_LABEL,
  SET_TYPES,
  addExerciseByName,
  addLiveSet,
  adjustRest,
  formatClock,
  formatPrevious,
  hasPendingSync,
  moveLiveExercise,
  removeLiveExercise,
  removeLiveSet,
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

function nextType(type: SetType): SetType {
  return SET_TYPES[(SET_TYPES.indexOf(type) + 1) % SET_TYPES.length];
}

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
    return (
      <div className={styles.page}>
        <section className={styles.empty}>
          <h1>Treinar</h1>
          <p>Nenhum treino em andamento. Como você quer treinar hoje?</p>
          <button type="button" className={styles.primary} onClick={startFree}>
            ⚡ Começar treino livre
          </button>
          <p className={styles.emptyHint}>Escolha os exercícios na hora. Não ocupa vaga de treino planejado.</p>
          <Link href="/dashboard#my-workouts" className={styles.secondary}>
            📋 Iniciar um treino planejado
          </Link>
          <Link href="/dashboard#workout-form" className={styles.linkBtn}>
            Criar minha rotina
          </Link>
        </section>
      </div>
    );
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  const stats = sessionStats(session);

  function renderSet(exerciseUid: string, set: LiveSet, index: number, previousText: string) {
    return (
      <div key={set.uid} className={`${styles.setRow} ${set.done ? styles.setDone : ''}`}>
        <button
          type="button"
          className={`${styles.typeBtn} ${styles[`type_${set.type}`]}`}
          aria-label={`Série ${index + 1}, tipo ${SET_TYPE_LABEL[set.type]}. Toque para mudar o tipo.`}
          onClick={() => editLive((c) => updateLiveSet(c, exerciseUid, set.uid, { type: nextType(set.type) }))}
        >
          {TYPE_LETTER[set.type] || index + 1}
        </button>
        <span className={styles.prev}>{previousText}</span>
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
          onClick={() => editLive((c) => removeLiveSet(c, exerciseUid, set.uid))}
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
        <p className={styles.syncLine} role="status" aria-live="polite">
          {syncLabel(sync, pending)}
        </p>
        <div className={styles.stats}>
          <div>
            <span>Duração</span>
            <strong>{formatClock(elapsed)}</strong>
          </div>
          <div>
            <span>Volume</span>
            <strong>{Math.round(stats.volume).toLocaleString('pt-BR')} kg</strong>
          </div>
          <div>
            <span>Séries</span>
            <strong>
              {stats.doneSets}/{stats.totalSets}
            </strong>
          </div>
        </div>
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

          {exercise.sets.map((set, index) =>
            renderSet(exercise.uid, set, index, formatPrevious(exercise.previous[index])),
          )}

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
        <label className={styles.restSetting}>
          Descanso após cada série (segundos)
          <input
            className={styles.field}
            type="number"
            inputMode="numeric"
            min="10"
            max="600"
            step="5"
            value={session.restSeconds}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value > 0) {
                editLive((c) => setRestDuration(c, value));
              }
            }}
          />
        </label>
        <p className={styles.legend}>
          Toque no número da série para alternar: A = aquecimento, D = drop set, F = falha. O volume não conta aquecimento.
        </p>
        <button type="button" className={styles.danger} onClick={handleDiscard}>
          Descartar treino
        </button>
      </section>

      {restLeft > 0 && (
        <div className={styles.rest} role="timer" aria-live="off">
          <span>
            Descanso <strong>{formatClock(restLeft)}</strong>
          </span>
          <div>
            <button type="button" onClick={() => liveStore.update((c) => (c ? adjustRest(c, -15, Date.now()) : c))}>
              −15s
            </button>
            <button type="button" onClick={() => liveStore.update((c) => (c ? adjustRest(c, 15, Date.now()) : c))}>
              +15s
            </button>
            <button type="button" onClick={() => liveStore.update((c) => (c ? skipRest(c) : c))}>
              Pular
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
