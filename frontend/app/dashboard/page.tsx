'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { cx } from '../../components/cx';
import StartChoices from '../../components/StartChoices';
import TrainingCalendar from '../../components/TrainingCalendar';
import ui from '../../components/ui.module.css';
import { api } from '../../services/api';
import { liveStore, useLiveSession } from '../../lib/use-live-session';
import { beginLiveSession, discardLiveSession } from '../../lib/session-sync';
import { draftStore, makeUid, TOKEN_KEY, useWorkoutDraft } from '../../lib/use-workout-draft';
import {
  SET_TYPE_LABEL,
  referenceSetsFor,
  startEmptySession,
  startInputFromPerformance,
  startSession,
  type ExercisePerformance,
  type RoutinePerformance,
  type SetType,
  type StartInput,
} from '../../lib/session';
import {
  DEFAULT_WORKOUT_LIMIT,
  quotaFor,
  shouldShowWelcome,
  type JourneyState,
  type OnboardingChoice,
} from '../../lib/journey';
import {
  WEEKDAY_LABELS,
  addCustomExercise,
  addSet,
  draftFromWorkout,
  formatWeekdays,
  isDraftEmpty,
  moveExercise,
  parseSetInput,
  removeExercise,
  removeSet,
  toPayload,
  toggleWeekday,
  updateSet,
  validateForSave,
  type WorkoutExercise,
  type WorkoutSet,
} from '../../lib/workout-draft';
import styles from './dashboard.module.css';

interface Workout {
  id: string;
  title: string;
  description: string | null;
  exercises?: WorkoutExercise[];
  weekdays?: number[];
  createdAt: string;
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

type Banner = { kind: 'success' | 'error'; lines: string[] } | null;

/** Referência de cada rotina (últimas séries feitas), indexada pelo ID da rotina. */
type PerformanceMap = Record<string, ExercisePerformance[]>;

/**
 * Busca no servidor as séries de referência de todas as rotinas: a mesma regra usada ao iniciar
 * o treino (último treino concluído da rotina, por exercício). Falhar aqui só faz o dashboard
 * mostrar os valores planejados.
 */
async function fetchPerformance(): Promise<PerformanceMap> {
  try {
    const response = await api.get<{ data: RoutinePerformance[] }>('/sessions/last-performance');
    return Object.fromEntries((response.data.data ?? []).map((routine) => [routine.workoutId, routine.exercises]));
  } catch (error) {
    console.warn('Não foi possível carregar as cargas do último treino.', error);
    return {};
  }
}

function isLimitError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409 && error.response.data?.code === 'WORKOUT_LIMIT_REACHED';
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const message: unknown = error.response?.data?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/**
 * Linha de uma série já cadastrada: peso e repetições editáveis.
 * A alteração é confirmada quando o foco sai da linha; valores inválidos voltam ao anterior.
 */
function SetRow({
  index,
  set,
  onChange,
  onRemove,
}: {
  index: number;
  set: WorkoutSet;
  onChange: (set: WorkoutSet) => void;
  onRemove: () => void;
}) {
  const [weight, setWeight] = useState(String(set.weight));
  const [reps, setReps] = useState(String(set.reps));

  function commit() {
    const parsed = parseSetInput(weight, reps);
    if ('error' in parsed) {
      setWeight(String(set.weight));
      setReps(String(set.reps));
      return;
    }
    if (parsed.set.weight !== set.weight || parsed.set.reps !== set.reps) onChange(parsed.set);
  }

  return (
    <div
      className={styles.setRow}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
    >
      <span className={styles.setLabel}>Série {index + 1}</span>
      <span className={styles.unitField}>
        <input
          className={cx(ui.control, ui.controlNumber, styles.unitInput)}
          aria-label={`Peso da série ${index + 1} (kg)`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
        <span className={styles.unit} aria-hidden="true">
          kg
        </span>
      </span>
      <span className={styles.unitField}>
        <input
          className={cx(ui.control, ui.controlNumber, styles.unitInput)}
          aria-label={`Repetições da série ${index + 1}`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
        />
        <span className={styles.unit} aria-hidden="true">
          reps
        </span>
      </span>
      <button
        type="button"
        className={cx(ui.btn, ui.btnDanger, styles.iconBtn)}
        aria-label={`Remover série ${index + 1}`}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const draft = useWorkoutDraft();
  const live = useLiveSession();

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualError, setManualError] = useState('');
  const [setInputs, setSetInputs] = useState<Record<string, { weight: string; reps: string }>>({});
  const [setErrors, setSetErrors] = useState<Record<string, string>>({});
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [performance, setPerformance] = useState<PerformanceMap>({});
  const [journeyPending, setJourneyPending] = useState(true);
  const [choosing, setChoosing] = useState<OnboardingChoice | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const loadWorkouts = useCallback(async () => {
    try {
      const [response, latest] = await Promise.all([api.get<Workout[]>('/workouts'), fetchPerformance()]);
      setWorkouts(Array.isArray(response.data) ? response.data : []);
      setPerformance(latest);
    } catch (error) {
      console.error(error);
      setBanner({ kind: 'error', lines: [apiErrorMessage(error, 'Não foi possível carregar seus treinos.')] });
    } finally {
      setLoadingWorkouts(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      router.replace('/');
      return;
    }
    // Carga inicial: o estado só é atualizado dentro dos callbacks da requisição
    // (nunca de forma síncrona no corpo do efeito). `loadingWorkouts` já nasce true.
    let cancelled = false;
    // Estado da jornada (persistido no servidor). Se falhar, o dashboard funciona normalmente.
    api
      .get<JourneyState>('/onboarding')
      .then((response) => {
        if (!cancelled) setJourney(response.data);
      })
      .catch((error: unknown) => console.warn('Não foi possível carregar o estado inicial.', error))
      .finally(() => {
        if (!cancelled) setJourneyPending(false);
      });
    void fetchPerformance().then((latest) => {
      if (!cancelled) setPerformance(latest);
    });
    api
      .get<Workout[]>('/workouts')
      .then((response) => {
        if (cancelled) return;
        setWorkouts(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(error);
        setBanner({ kind: 'error', lines: [apiErrorMessage(error, 'Não foi possível carregar seus treinos.')] });
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkouts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const workoutLimit = journey?.plannedWorkouts.limit ?? DEFAULT_WORKOUT_LIMIT;
  const quota = loadingWorkouts ? null : quotaFor(workouts.length, workoutLimit);
  const atLimit = quota !== null && quota.remaining === 0 && draft.editingId === null;
  const showWelcome = !loadingWorkouts && shouldShowWelcome(journey, workouts.length > 0, live !== null);

  const totalExercises = workouts.reduce((total, workout) => total + (workout.exercises?.length ?? 0), 0);
  // Séries de referência (último treino concluído; sem histórico, as planejadas), como nos cartões.
  const totalSets = workouts.reduce(
    (total, workout) =>
      total +
      (workout.exercises?.reduce(
        (sum, exercise, index) => sum + referenceSetsFor(exercise, index, performance[workout.id]).sets.length,
        0,
      ) ?? 0),
    0,
  );

  /** Registra a primeira escolha no servidor. Falhar aqui não impede o usuário de seguir. */
  async function completeOnboarding(choice: OnboardingChoice) {
    try {
      const response = await api.post<JourneyState>('/onboarding/complete', { choice });
      setJourney(response.data);
    } catch (error) {
      console.warn('Não foi possível registrar a escolha inicial.', error);
      setJourney((current) => (current ? { ...current, onboardingCompleted: true, choice } : current));
    }
  }

  function focusWorkoutForm() {
    // Espera o formulário aparecer (ao sair das boas-vindas) antes de rolar e focar.
    window.setTimeout(() => {
      document.getElementById('workout-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titleInputRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  async function handleCreateRoutine() {
    if (showWelcome) {
      setChoosing('routine');
      await completeOnboarding('routine');
      setChoosing(null);
      setGuideOpen(true);
    }
    focusWorkoutForm();
  }

  /** Treino livre: abre (ou retoma) uma sessão sem treino planejado e sem ocupar vaga. */
  async function handleStartFree() {
    // Já há um treino em andamento (neste aparelho ou salvo na conta): retoma em vez de abrir outro.
    if (liveStore.getSnapshot() || journey?.activeSession) {
      router.push('/train');
      return;
    }
    if (showWelcome) {
      setChoosing('free');
      await completeOnboarding('free');
    }
    beginLiveSession(startEmptySession(makeUid, new Date().toISOString()));
    router.push('/train');
  }

  function discardDraft() {
    draftStore.clear();
    setSetInputs({});
    setSetErrors({});
    setManualName('');
    setManualError('');
  }

  function handleCancel() {
    if (!isDraftEmpty(draft)) {
      const question = draft.editingId
        ? 'Cancelar a edição e descartar as alterações não salvas?'
        : 'Descartar o rascunho do treino?';
      if (!window.confirm(question)) return;
    }
    discardDraft();
    setBanner(null);
  }

  function handleAddManual() {
    const result = addCustomExercise(draftStore.getSnapshot(), manualName, makeUid);
    if ('error' in result) {
      setManualError(result.error);
      return;
    }
    draftStore.update(() => result.draft);
    setManualName('');
    setManualError('');
  }

  function handleManualKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault(); // evita enviar o formulário do treino sem querer
      handleAddManual();
    }
  }

  function handleAddSet(uid: string) {
    const input = setInputs[uid] ?? { weight: '', reps: '' };
    const parsed = parseSetInput(input.weight, input.reps);
    if ('error' in parsed) {
      setSetErrors((previous) => ({ ...previous, [uid]: parsed.error }));
      return;
    }
    draftStore.update((current) => addSet(current, uid, parsed.set));
    setSetErrors((previous) => ({ ...previous, [uid]: '' }));
    // Mantém os valores preenchidos: é comum repetir a mesma carga em várias séries.
  }

  function handleSetInputKey(event: KeyboardEvent<HTMLInputElement>, uid: string) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddSet(uid);
    }
  }

  function updateSetInput(uid: string, field: 'weight' | 'reps', value: string) {
    setSetInputs((previous) => ({
      ...previous,
      [uid]: { weight: previous[uid]?.weight ?? '', reps: previous[uid]?.reps ?? '', [field]: value },
    }));
  }

  async function handleSaveWorkout(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const current = draftStore.getSnapshot();
    const errors = validateForSave(current);
    if (errors.length > 0) {
      setBanner({ kind: 'error', lines: errors });
      return;
    }
    if (current.editingId === null && atLimit) {
      setBanner({
        kind: 'error',
        lines: [
          `Você já tem ${workoutLimit} treinos planejados, o máximo permitido. Exclua um treino que não usa mais ` +
            'ou edite um existente. Seu rascunho continua guardado.',
        ],
      });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const payload = toPayload(current);
      if (current.editingId) {
        await api.patch(`/workouts/${current.editingId}`, payload);
      } else {
        await api.post('/workouts', payload);
      }
      // Só descarta o rascunho depois que a API confirmou o salvamento.
      const wasEditing = current.editingId !== null;
      discardDraft();
      setBanner({
        kind: 'success',
        lines: [wasEditing ? 'Treino atualizado com sucesso!' : 'Treino cadastrado com sucesso!'],
      });
      await loadWorkouts();
    } catch (error) {
      console.error(error);
      if (isLimitError(error)) {
        // O servidor é quem garante o limite: atualiza a lista para mostrar as vagas reais.
        await loadWorkouts();
        setBanner({ kind: 'error', lines: [`${apiErrorMessage(error, '')} Seu rascunho continua guardado.`] });
        return;
      }
      setBanner({
        kind: 'error',
        lines: [
          `${apiErrorMessage(error, 'Erro ao salvar o treino.')} Seu rascunho foi mantido; tente novamente.`,
        ],
      });
    } finally {
      setSaving(false);
    }
  }

  function handleEditWorkout(workout: Workout) {
    const current = draftStore.getSnapshot();
    if (!isDraftEmpty(current) && current.editingId !== workout.id) {
      if (!window.confirm('Há um rascunho em andamento. Substituí-lo pela edição deste treino?')) return;
    }
    if (current.editingId !== workout.id || isDraftEmpty(current)) {
      draftStore.update(() => draftFromWorkout(workout, makeUid));
      setSetInputs({});
      setSetErrors({});
    }
    setBanner(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDeleteWorkout(id: string) {
    if (
      !window.confirm(
        'Deseja realmente excluir este treino planejado? Isso libera uma vaga; o histórico dos treinos já feitos é mantido.',
      )
    ) {
      return;
    }

    try {
      await api.delete(`/workouts/${id}`);
      if (draftStore.getSnapshot().editingId === id) discardDraft();
      await loadWorkouts();
      setBanner({ kind: 'success', lines: ['Treino excluído. Uma vaga foi liberada.'] });
    } catch (error) {
      console.error(error);
      setBanner({ kind: 'error', lines: [apiErrorMessage(error, 'Erro ao excluir treino.')] });
    }
  }

  /** Inicia um treino a partir da rotina; busca as últimas cargas para servir de referência. */
  async function handleStartWorkout(workout: Workout) {
    const current = liveStore.getSnapshot();
    if (current) {
      if (!window.confirm(`Já existe um treino em andamento ("${current.title}"). Descartá-lo e iniciar este?`)) {
        return;
      }
      await discardLiveSession();
    }
    // Referência calculada no servidor: séries e cargas do último treino concluído DESTA rotina,
    // por exercício (ou as planejadas, para exercícios ainda sem histórico).
    let input: StartInput;
    try {
      const response = await api.get<{ title: string; exercises: ExercisePerformance[] }>(
        `/sessions/last-performance/${workout.id}`,
      );
      input = startInputFromPerformance(workout.id, response.data.title, response.data.exercises);
    } catch (error) {
      console.warn('Não foi possível buscar as cargas do último treino.', error);
      if (
        !window.confirm(
          'Não foi possível carregar as cargas do seu último treino (sem conexão?). ' +
            'Iniciar com os valores planejados na rotina?',
        )
      ) {
        return;
      }
      input = { workoutId: workout.id, title: workout.title, exercises: workout.exercises ?? [] };
    }
    // Inicia uma SESSÃO a partir do modelo: o treino planejado não é copiado nem alterado.
    beginLiveSession(startSession(input, makeUid, new Date().toISOString()));
    router.push('/train');
  }

  if (loadingWorkouts || journeyPending) {
    return (
      <div className={styles.page}>
        <p className={ui.loadingText} role="status">
          Carregando…
        </p>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <div className={styles.page}>
        <header className={styles.welcomeHeader}>
          <h1 className={ui.pageTitle}>Vamos organizar seus treinos?</h1>
          <p className={ui.pageSubtitle}>Monte sua rotina semanal ou comece a treinar agora. Você escolhe.</p>
        </header>
        <StartChoices
          variant="welcome"
          quota={quota}
          liveTitle={null}
          busy={choosing}
          onCreateRoutine={() => void handleCreateRoutine()}
          onStartFree={() => void handleStartFree()}
        />
        <p className={styles.welcomeNote}>
          As duas opções continuam disponíveis no painel. Você pode treinar livre hoje e montar a rotina depois.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={ui.pageTitle}>Seus treinos</h1>
        <p className={ui.pageSubtitle}>Gerencie seus treinos, exercícios, séries, cargas e repetições.</p>
      </header>

      {live && (
        <Link href="/train" className={styles.liveBanner}>
          ▶ Treino em andamento: <strong>{live.title}</strong> — continuar
        </Link>
      )}

      <section aria-label="Começar">
        <StartChoices
          variant="compact"
          quota={quota}
          liveTitle={live?.title ?? journey?.activeSession?.title ?? null}
          hasDraft={!isDraftEmpty(draft)}
          onCreateRoutine={() => void handleCreateRoutine()}
          onStartFree={() => void handleStartFree()}
        />
      </section>

      {/* Dias realmente treinados nesta semana (sessões concluídas). */}
      <TrainingCalendar mode="week" />

      <section className={styles.stats} aria-label="Resumo dos treinos">
        <div className={cx(ui.card, styles.statCard)}>
          <strong>{workouts.length}</strong>
          <span>Treinos (de {workoutLimit})</span>
        </div>

        <div className={cx(ui.card, styles.statCard)}>
          <strong>{totalExercises}</strong>
          <span>Exercícios</span>
        </div>

        <div className={cx(ui.card, styles.statCard)}>
          <strong>{totalSets}</strong>
          <span>Séries</span>
        </div>
      </section>

      <section id="workout-form" className={cx(ui.card, styles.formCard)} aria-labelledby="form-title">
        <h2 id="form-title" className={ui.sectionTitle}>
          {draft.editingId ? 'Editar treino' : 'Novo treino planejado'}
          {!draft.editingId && quota && (
            <span className={styles.slotTag}>
              {quota.remaining > 0
                ? `${quota.remaining} ${quota.remaining === 1 ? 'vaga livre' : 'vagas livres'}`
                : 'sem vagas'}
            </span>
          )}
        </h2>

        {atLimit && (
          <div className={ui.bannerInfo} role="status">
            Você já tem {workoutLimit} de {workoutLimit} treinos planejados. Para criar outro, exclua um treino que
            não usa mais ou edite um existente na lista abaixo. Treinos livres e o histórico não contam neste limite.
          </div>
        )}

        {!draft.editingId && (guideOpen || (quota !== null && quota.used === 0)) && (
          <ol className={styles.guide} aria-label="Como montar seu treino">
            <li>Dê um nome, por exemplo “Treino A — Peito e costas”.</li>
            <li>Adicione exercícios do catálogo ou digite o nome de um exercício.</li>
            <li>Informe peso e repetições de cada série.</li>
            <li>Salve. Pode começar com um treino só; os dias da semana são opcionais.</li>
          </ol>
        )}

        {banner && (
          <div
            className={banner.kind === 'error' ? ui.bannerError : ui.bannerSuccess}
            role={banner.kind === 'error' ? 'alert' : 'status'}
          >
            {banner.lines.map((line) => (
              <p key={line} className={styles.bannerLine}>
                {line}
              </p>
            ))}
          </div>
        )}

        <form onSubmit={handleSaveWorkout} className={styles.form}>
          <label className={ui.fieldLabel}>
            Título do treino
            <input
              ref={titleInputRef}
              className={ui.control}
              placeholder="Ex.: Treino A — Peito e tríceps"
              value={draft.title}
              onChange={(event) => draftStore.update((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label className={ui.fieldLabel}>
            Descrição
            <textarea
              className={cx(ui.control, ui.controlTextarea)}
              placeholder="Opcional"
              value={draft.description}
              onChange={(event) =>
                draftStore.update((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>

          <fieldset className={styles.weekdays}>
            <legend className={ui.fieldLabel}>Dias da semana (opcional)</legend>
            <div className={styles.weekdayChips}>
              {WEEKDAY_LABELS.map((label, day) => {
                const selected = draft.weekdays.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    className={cx(styles.weekdayChip, selected && styles.weekdayChipOn)}
                    aria-pressed={selected}
                    aria-label={WEEKDAY_NAMES[day]}
                    onClick={() => draftStore.update((current) => toggleWeekday(current, day))}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className={styles.exerciseBox}>
            <h3 className={styles.boxTitle}>Adicionar exercício</h3>
            <p className={styles.hint}>
              Escolha no catálogo (com imagens e instruções) ou digite um exercício próprio.
            </p>

            <Link href="/exercises" className={cx(ui.btn, ui.btnPrimary, styles.catalogBtn)}>
              📚 Escolher do catálogo
            </Link>

            <div className={styles.manualRow}>
              <input
                className={ui.control}
                placeholder="Ou digite o nome de um exercício"
                aria-label="Nome do exercício"
                value={manualName}
                onChange={(event) => {
                  setManualName(event.target.value);
                  setManualError('');
                }}
                onKeyDown={handleManualKey}
              />
              <button type="button" className={cx(ui.btn, ui.btnSecondary)} onClick={handleAddManual}>
                + Adicionar
              </button>
            </div>
            {manualError && <p className={styles.fieldError}>{manualError}</p>}
          </div>

          <div className={styles.exerciseBox} id="exercise-list">
            <h3 className={styles.boxTitle}>Exercícios do treino ({draft.exercises.length})</h3>

            {draft.exercises.length === 0 && (
              <p className={styles.hint}>Nenhum exercício ainda. Escolha um no catálogo ou adicione manualmente.</p>
            )}

            {draft.exercises.map((exercise, exerciseIndex) => {
              const input = setInputs[exercise.uid] ?? { weight: '', reps: '' };
              return (
                <div key={exercise.uid} className={styles.draftExercise}>
                  <div className={styles.draftExerciseHeader}>
                    <strong className={styles.exerciseName}>
                      {exerciseIndex + 1}. {exercise.name}
                    </strong>
                    <div className={styles.iconButtons}>
                      <button
                        type="button"
                        className={cx(ui.btn, ui.btnSecondary, styles.iconBtn)}
                        aria-label={`Mover ${exercise.name} para cima`}
                        disabled={exerciseIndex === 0}
                        onClick={() => draftStore.update((current) => moveExercise(current, exercise.uid, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={cx(ui.btn, ui.btnSecondary, styles.iconBtn)}
                        aria-label={`Mover ${exercise.name} para baixo`}
                        disabled={exerciseIndex === draft.exercises.length - 1}
                        onClick={() => draftStore.update((current) => moveExercise(current, exercise.uid, 1))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={cx(ui.btn, ui.btnDanger, styles.compactBtn)}
                        aria-label={`Remover ${exercise.name} do treino`}
                        onClick={() => draftStore.update((current) => removeExercise(current, exercise.uid))}
                      >
                        Remover
                      </button>
                    </div>
                  </div>

                  {exercise.sets.length === 0 ? (
                    <p className={styles.warning}>Sem séries. Adicione pelo menos uma abaixo para poder salvar.</p>
                  ) : (
                    exercise.sets.map((set, setIndex) => (
                      <SetRow
                        key={`${exercise.uid}-${setIndex}-${set.weight}-${set.reps}`}
                        index={setIndex}
                        set={set}
                        onChange={(next) =>
                          draftStore.update((current) => updateSet(current, exercise.uid, setIndex, next))
                        }
                        onRemove={() => draftStore.update((current) => removeSet(current, exercise.uid, setIndex))}
                      />
                    ))
                  )}

                  <div className={styles.addSetRow}>
                    <span className={styles.unitField}>
                      <input
                        className={cx(ui.control, ui.controlNumber, styles.unitInput)}
                        aria-label={`Peso para ${exercise.name}`}
                        placeholder="Peso"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.5"
                        value={input.weight}
                        onChange={(event) => updateSetInput(exercise.uid, 'weight', event.target.value)}
                        onKeyDown={(event) => handleSetInputKey(event, exercise.uid)}
                      />
                      <span className={styles.unit} aria-hidden="true">
                        kg
                      </span>
                    </span>
                    <span className={styles.unitField}>
                      <input
                        className={cx(ui.control, ui.controlNumber, styles.unitInput)}
                        aria-label={`Repetições para ${exercise.name}`}
                        placeholder="Repetições"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={input.reps}
                        onChange={(event) => updateSetInput(exercise.uid, 'reps', event.target.value)}
                        onKeyDown={(event) => handleSetInputKey(event, exercise.uid)}
                      />
                      <span className={styles.unit} aria-hidden="true">
                        reps
                      </span>
                    </span>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.btnSecondary, styles.addSetBtn)}
                      onClick={() => handleAddSet(exercise.uid)}
                    >
                      + Série
                    </button>
                  </div>
                  {setErrors[exercise.uid] && <p className={styles.fieldError}>{setErrors[exercise.uid]}</p>}
                </div>
              );
            })}
          </div>

          <div className={styles.formActions}>
            <button type="submit" className={cx(ui.btn, ui.btnPrimary)} disabled={saving || atLimit}>
              {saving
                ? 'Salvando...'
                : draft.editingId
                  ? 'Atualizar treino'
                  : atLimit
                    ? 'Limite de treinos atingido'
                    : 'Salvar treino'}
            </button>

            {!isDraftEmpty(draft) && (
              <button type="button" className={cx(ui.btn, ui.btnSecondary)} onClick={handleCancel} disabled={saving}>
                {draft.editingId ? 'Cancelar edição' : 'Descartar rascunho'}
              </button>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="my-workouts">
        <h2 id="my-workouts" className={styles.listTitle}>
          Meus treinos{quota ? ` — ${quota.used} de ${quota.limit}` : ''}
        </h2>

        {loadingWorkouts ? (
          <p className={ui.loadingText} role="status">
            Carregando treinos…
          </p>
        ) : workouts.length === 0 ? (
          <div className={cx(ui.card, ui.emptyState)}>
            <p>Nenhum treino planejado ainda. Monte o primeiro no formulário acima ou comece um treino livre.</p>
          </div>
        ) : (
          <div className={styles.cards}>
            {workouts.map((workout) => (
              <article key={workout.id} className={cx(ui.card, styles.card)}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitleBlock}>
                    <h3>{workout.title}</h3>
                    {workout.description && <p>{workout.description}</p>}
                    {workout.weekdays && workout.weekdays.length > 0 && (
                      <p className={styles.cardDays}>📅 {formatWeekdays(workout.weekdays)}</p>
                    )}
                  </div>

                  <small>{new Date(workout.createdAt).toLocaleDateString('pt-BR')}</small>
                </div>

                {workout.exercises && workout.exercises.length > 0 && (
                  <div className={styles.exerciseList}>
                    {workout.exercises.map((exercise, index) => {
                      const reference = referenceSetsFor(exercise, index, performance[workout.id]);
                      return (
                        <div key={`${exercise.exerciseId ?? exercise.name}-${index}`} className={styles.exerciseCard}>
                          <h4>💪 {exercise.name}</h4>
                          <p className={styles.setSource}>
                            {reference.source === 'last_session' && reference.performedAt
                              ? `Último treino · ${new Date(reference.performedAt).toLocaleDateString('pt-BR')}`
                              : 'Planejado (ainda sem treino concluído)'}
                          </p>

                          <table className={styles.setTable}>
                            <thead>
                              <tr>
                                <th scope="col">Série</th>
                                <th scope="col">Peso</th>
                                <th scope="col">Reps</th>
                              </tr>
                            </thead>

                            <tbody>
                              {reference.sets.map((set, setIndex) => (
                                <tr key={`${set.weight}-${set.reps}-${setIndex}`}>
                                  <td>
                                    {setIndex + 1}
                                    {set.type !== 'normal' && set.type in SET_TYPE_LABEL && (
                                      <small> · {SET_TYPE_LABEL[set.type as SetType]}</small>
                                    )}
                                  </td>
                                  <td>{set.weight}kg</td>
                                  <td>{set.reps}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={cx(ui.btn, ui.btnPrimary)}
                    onClick={() => void handleStartWorkout(workout)}
                  >
                    ▶ Iniciar treino
                  </button>

                  <button type="button" className={cx(ui.btn, ui.btnWarning)} onClick={() => handleEditWorkout(workout)}>
                    Editar
                  </button>

                  <button
                    type="button"
                    className={cx(ui.btn, ui.btnDanger)}
                    onClick={() => handleDeleteWorkout(workout.id)}
                  >
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
