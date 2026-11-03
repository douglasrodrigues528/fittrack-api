'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { cx } from '../../components/cx';
import StartChoices from '../../components/StartChoices';
import TrainingCalendar from '../../components/TrainingCalendar';
import ui from '../../components/ui.module.css';
import { api } from '../../services/api';
import { liveStore, useLiveSession } from '../../lib/use-live-session';
import { beginLiveSession } from '../../lib/session-sync';
import { startRoutineSession } from '../../lib/start-routine';
import { draftStore, makeUid, TOKEN_KEY, useWorkoutDraft } from '../../lib/use-workout-draft';
import {
  SET_TYPE_LABEL,
  referenceSetsFor,
  startEmptySession,
  type ExercisePerformance,
  type RoutinePerformance,
  type SetType,
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

/** Fragmento atual da URL (#...), acompanhando navegação com âncora sem recarregar a página. */
function subscribeHash(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}
const readHash = () => window.location.hash;
const serverHash = () => '';

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

/** Ações secundárias da rotina (Editar e Excluir), num menu que abre no próprio cartão. */
function RoutineMenu({ title, onEdit, onDelete }: { title: string; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Ao abrir, o foco vai para a primeira ação; tocar fora fecha sem executar nada.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next: Record<string, number> = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in next) {
      event.preventDefault();
      items[next[event.key]]?.focus();
    }
  }

  /** O foco volta ao botão do menu antes da ação: é para ele que a confirmação devolve o foco. */
  function run(action: () => void) {
    close();
    action();
  }

  return (
    <div ref={rootRef} className={styles.menuRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(ui.btn, ui.btnSecondary, styles.menuBtn)}
        aria-label={`Mais ações da rotina ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Mais ações <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label={`Ações da rotina ${title}`} onKeyDown={handleMenuKey}>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => run(onEdit)}>
            Editar
          </button>
          <button
            type="button"
            role="menuitem"
            className={cx(styles.menuItem, styles.menuItemDanger)}
            onClick={() => run(onDelete)}
          >
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

/** Confirmação de exclusão: diálogo nativo (prende o foco, fecha com Esc) que começa em "Cancelar". */
function DeleteRoutineDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="delete-routine-title"
      aria-describedby="delete-routine-text"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="delete-routine-title" className={ui.sectionTitle}>
        Excluir “{title}”?
      </h2>
      <p id="delete-routine-text" className={styles.dialogText}>
        A rotina sai da lista e libera uma vaga. O histórico dos treinos já feitos é mantido.
      </p>
      <div className={styles.dialogActions}>
        <button type="button" className={cx(ui.btn, ui.btnSecondary)} onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className={cx(ui.btn, styles.dialogDanger)} onClick={onConfirm}>
          Excluir rotina
        </button>
      </div>
    </dialog>
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
  // Formulário de rotina fechado por padrão. Em 'auto' ele só aparece se já houver um rascunho
  // ou se a página foi aberta em #workout-form (links do catálogo e da tela de treino).
  const [formMode, setFormMode] = useState<'auto' | 'open' | 'closed'>('auto');
  const formLinkRequested = useSyncExternalStore(subscribeHash, readHash, serverHash) === '#workout-form';
  // Rotinas com a lista de exercícios expandida (recolhidas por padrão).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  // Cada pedido de "ir ao formulário" (criar, editar) incrementa; o efeito age depois que ele aparece.
  const [formFocusRequest, setFormFocusRequest] = useState(0);
  // Para onde o foco volta se a exclusão for cancelada (o botão do menu daquele cartão).
  const deleteOriginRef = useRef<HTMLElement | null>(null);

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

  // Nova navegação para #workout-form com a página já aberta: é um pedido explícito, reabre o formulário.
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#workout-form') setFormMode('open');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Chegou por um link #workout-form: rola até o formulário quando a página termina de carregar.
  useEffect(() => {
    if (formLinkRequested && !loadingWorkouts && !journeyPending) {
      document.getElementById('workout-form')?.scrollIntoView({ block: 'start' });
    }
  }, [formLinkRequested, loadingWorkouts, journeyPending]);

  useEffect(() => {
    if (formFocusRequest === 0) return;
    document.getElementById('workout-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titleInputRef.current?.focus({ preventScroll: true });
  }, [formFocusRequest]);

  const workoutLimit = journey?.plannedWorkouts.limit ?? DEFAULT_WORKOUT_LIMIT;
  const quota = loadingWorkouts ? null : quotaFor(workouts.length, workoutLimit);
  const atLimit = quota !== null && quota.remaining === 0 && draft.editingId === null;
  const formOpen = formMode === 'open' || (formMode === 'auto' && (!isDraftEmpty(draft) || formLinkRequested));
  const needsOnboarding = !loadingWorkouts && shouldShowWelcome(journey, workouts.length > 0, live !== null);
  // Quem já está montando uma rotina (rascunho ou link direto) vai ao formulário, sem repetir o convite.
  const showWelcome = needsOnboarding && !formOpen;
  // Treino em andamento neste aparelho ou salvo na conta (o outro aparelho também retoma por aqui).
  const liveTitle = live?.title ?? journey?.activeSession?.title ?? null;

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

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateRoutine() {
    if (needsOnboarding) {
      setChoosing('routine');
      await completeOnboarding('routine');
      setChoosing(null);
      setGuideOpen(true);
    }
    setFormMode('open');
    setFormFocusRequest((request) => request + 1);
  }

  /** Treino livre: abre (ou retoma) uma sessão sem treino planejado e sem ocupar vaga. */
  async function handleStartFree() {
    // Já há um treino em andamento (neste aparelho ou salvo na conta): retoma em vez de abrir outro.
    if (liveStore.getSnapshot() || journey?.activeSession) {
      router.push('/train');
      return;
    }
    if (needsOnboarding) {
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
        : 'Descartar o rascunho da rotina?';
      if (!window.confirm(question)) return;
    }
    discardDraft();
    setBanner(null);
    setFormMode('closed');
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
          `Você já tem ${workoutLimit} rotinas, o máximo permitido. Exclua uma que não usa mais ` +
            'ou edite uma existente. Seu rascunho continua guardado.',
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
      // Salvo: o formulário fecha e a rotina aparece na lista, com o aviso de sucesso acima dela.
      setFormMode('closed');
      setBanner({
        kind: 'success',
        lines: [wasEditing ? 'Rotina atualizada com sucesso!' : 'Rotina criada com sucesso!'],
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
          `${apiErrorMessage(error, 'Erro ao salvar a rotina.')} Seu rascunho foi mantido; tente novamente.`,
        ],
      });
    } finally {
      setSaving(false);
    }
  }

  function handleEditWorkout(workout: Workout) {
    const current = draftStore.getSnapshot();
    if (!isDraftEmpty(current) && current.editingId !== workout.id) {
      if (!window.confirm('Há um rascunho em andamento. Substituí-lo pela edição desta rotina?')) return;
    }
    if (current.editingId !== workout.id || isDraftEmpty(current)) {
      draftStore.update(() => draftFromWorkout(workout, makeUid));
      setSetInputs({});
      setSetErrors({});
    }
    setBanner(null);
    setFormMode('open');
    setFormFocusRequest((request) => request + 1);
  }

  function askDeleteWorkout(workout: Workout) {
    deleteOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleting(workout);
  }

  function cancelDelete() {
    setDeleting(null);
    window.setTimeout(() => deleteOriginRef.current?.focus(), 0);
  }

  async function confirmDelete() {
    if (!deleting) return;
    const { id } = deleting;
    setDeleting(null);
    try {
      await api.delete(`/workouts/${id}`);
      if (draftStore.getSnapshot().editingId === id) discardDraft();
      await loadWorkouts();
      setBanner({ kind: 'success', lines: ['Rotina excluída. Uma vaga foi liberada.'] });
      // O cartão (e o botão que abriu a confirmação) saiu da tela: o foco vai para o título da lista.
      headingRef.current?.focus({ preventScroll: true });
    } catch (error) {
      console.error(error);
      setBanner({ kind: 'error', lines: [apiErrorMessage(error, 'Erro ao excluir a rotina.')] });
      deleteOriginRef.current?.focus();
    }
  }

  async function handleStartWorkout(workout: Workout) {
    if (await startRoutineSession(workout)) router.push('/train');
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
      <header className={styles.listHeader}>
        <div className={styles.listHeading}>
          <h1 id="my-workouts" ref={headingRef} tabIndex={-1} className={styles.listTitle}>
            Minhas rotinas
          </h1>
          {quota && (
            <p className={styles.quotaLine}>
              {quota.used} de {quota.limit} rotinas
              {quota.remaining === 0 && ' · para criar outra, exclua ou edite uma. Treino livre não ocupa vaga.'}
            </p>
          )}
        </div>
        {!formOpen && (
          <button
            type="button"
            className={cx(ui.btn, styles.newRoutineBtn)}
            onClick={() => void handleCreateRoutine()}
            disabled={atLimit && isDraftEmpty(draft)}
          >
            {!isDraftEmpty(draft) && !draft.editingId ? 'Continuar rascunho' : '+ Nova rotina'}
          </button>
        )}
      </header>

      {liveTitle && (
        <Link href="/train" className={styles.liveBanner}>
          ▶ Treino em andamento: <strong>{liveTitle}</strong> — continuar
        </Link>
      )}

      {/* Avisos (salvo, excluído, erro ao carregar) ficam visíveis mesmo com o formulário fechado. */}
      {banner && !formOpen && (
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

      <section aria-labelledby="my-workouts">
        {loadingWorkouts ? (
          <p className={ui.loadingText} role="status">
            Carregando treinos…
          </p>
        ) : workouts.length === 0 ? (
          !formOpen && (
            <div className={cx(ui.card, styles.emptyRoutines)}>
              <p className={styles.emptyTitle}>Você ainda não tem rotinas.</p>
              <p className={styles.emptyText}>
                Monte a primeira com os exercícios que costuma fazer: ela fica salva para iniciar com um toque.
              </p>
            </div>
          )
        ) : (
          <div className={styles.cards}>
            {workouts.map((workout) => {
              const exercises = workout.exercises ?? [];
              const references = exercises.map((exercise, index) =>
                referenceSetsFor(exercise, index, performance[workout.id]),
              );
              const setCount = references.reduce((total, reference) => total + reference.sets.length, 0);
              const lastDone = references
                .map((reference) => reference.performedAt)
                .filter((date): date is string => date !== null)
                .sort()
                .pop();
              const isOpen = expanded.has(workout.id);
              const detailsId = `workout-details-${workout.id}`;
              return (
                <article key={workout.id} className={cx(ui.card, styles.card)}>
                  <div className={styles.cardTitleBlock}>
                    <h3>{workout.title}</h3>
                    <p className={styles.cardSummary}>
                      {exercises.length} {exercises.length === 1 ? 'exercício' : 'exercícios'} · {setCount}{' '}
                      {setCount === 1 ? 'série' : 'séries'}
                      {lastDone && ` · último treino em ${new Date(lastDone).toLocaleDateString('pt-BR')}`}
                    </p>
                    {workout.weekdays && workout.weekdays.length > 0 && (
                      <p className={styles.cardDays}>📅 {formatWeekdays(workout.weekdays)}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    className={cx(ui.btn, ui.btnPrimary, ui.btnBlock, styles.startBtn)}
                    onClick={() => void handleStartWorkout(workout)}
                  >
                    ▶ Iniciar treino
                  </button>

                  <div className={styles.cardTools}>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.btnSecondary, styles.toolBtn)}
                      aria-expanded={isOpen}
                      aria-controls={detailsId}
                      onClick={() => toggleExpanded(workout.id)}
                      disabled={exercises.length === 0}
                    >
                      {isOpen ? 'Ocultar exercícios' : 'Ver exercícios'}
                    </button>

                    <RoutineMenu
                      title={workout.title}
                      onEdit={() => handleEditWorkout(workout)}
                      onDelete={() => askDeleteWorkout(workout)}
                    />
                  </div>

                  {isOpen && (
                    <div id={detailsId} className={styles.cardDetails}>
                      {workout.description && <p className={styles.cardDescription}>{workout.description}</p>}
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
                      <small className={styles.createdAt}>
                        Criado em {new Date(workout.createdAt).toLocaleDateString('pt-BR')}
                      </small>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {formOpen && (
        <section id="workout-form" className={cx(ui.card, styles.formCard)} aria-labelledby="form-title">
          <div className={styles.formHeader}>
            <button
              type="button"
              className={cx(ui.btn, ui.btnSecondary, styles.closeFormBtn)}
              onClick={() => setFormMode('closed')}
              aria-label="Fechar formulário (o rascunho continua guardado)"
            >
              Fechar
            </button>
          </div>
          <h2 id="form-title" className={ui.sectionTitle}>
            {draft.editingId ? 'Editar rotina' : 'Nova rotina'}
          </h2>

          {atLimit && (
            <div className={ui.bannerInfo} role="status">
              Você atingiu o limite de rotinas. Para criar outra, exclua uma que não usa mais ou edite uma existente na
              lista acima. Treinos livres e o histórico não contam neste limite.
            </div>
          )}

          {!draft.editingId && (guideOpen || (quota !== null && quota.used === 0)) && (
            <ol className={styles.guide} aria-label="Como montar sua rotina">
              <li>Dê um nome, por exemplo “Treino A — Peito e costas”.</li>
              <li>Adicione exercícios do catálogo ou digite o nome de um exercício.</li>
              <li>Informe peso e repetições de cada série.</li>
              <li>Salve. Pode começar com uma rotina só; os dias da semana são opcionais.</li>
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
              Nome da rotina
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
              <h3 className={styles.boxTitle}>Exercícios da rotina ({draft.exercises.length})</h3>

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
                          aria-label={`Remover ${exercise.name} da rotina`}
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
                    ? 'Atualizar rotina'
                    : atLimit
                      ? 'Limite de rotinas atingido'
                      : 'Salvar rotina'}
              </button>

              {!isDraftEmpty(draft) && (
                <button type="button" className={cx(ui.btn, ui.btnSecondary)} onClick={handleCancel} disabled={saving}>
                  {draft.editingId ? 'Cancelar edição' : 'Descartar rascunho'}
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {!liveTitle && (
        <section className={cx(ui.card, styles.freeRow)} aria-label="Treino livre">
          <p className={styles.freeText}>
            <strong>Treino livre</strong>
            <span>Treine agora escolhendo os exercícios na hora. Não ocupa vaga de rotina.</span>
          </p>
          <button type="button" className={cx(ui.btn, ui.btnSecondary)} onClick={() => void handleStartFree()}>
            Começar treino livre
          </button>
        </section>
      )}

      {/* Dias realmente treinados nesta semana (sessões concluídas). */}
      <TrainingCalendar mode="week" />

      {deleting && (
        <DeleteRoutineDialog
          title={deleting.title}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
