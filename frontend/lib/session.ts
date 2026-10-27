/**
 * Lógica pura da sessão de treino ao vivo (o que acontece na academia).
 * A sessão fica gravada no aparelho a cada toque e é sincronizada com a API enquanto
 * acontece (para retomar depois de recarregar ou em outro aparelho). Ao finalizar,
 * só as séries realizadas vão para o histórico.
 */
import type { WorkoutExercise } from './workout-draft';

export const SET_TYPES = ['warmup', 'normal', 'drop', 'failure'] as const;
export type SetType = (typeof SET_TYPES)[number];

export const SET_TYPE_LABEL: Record<SetType, string> = {
  warmup: 'Aquecimento',
  normal: 'Normal',
  drop: 'Drop set',
  failure: 'Falha',
};

export const DEFAULT_REST_SECONDS = 90;

export interface LiveSet {
  uid: string;
  type: SetType;
  /** Texto digitado (facilita edição no celular). */
  weight: string;
  reps: string;
  done: boolean;
}

export interface PreviousSet {
  type: string;
  weight: number;
  reps: number;
}

export interface LiveExercise {
  uid: string;
  exerciseId?: string;
  name: string;
  sets: LiveSet[];
  /** Séries da última vez que este exercício foi feito (referência visual). */
  previous: PreviousSet[];
}

export type SessionOrigin = 'planned' | 'free';

export interface LiveSession {
  /** Identidade local estável (não muda ao sincronizar). */
  localId: string;
  /** ID da sessão no servidor; null enquanto ainda não foi criada lá (ex.: sem conexão). */
  serverId: string | null;
  origin: SessionOrigin;
  workoutId: string | null;
  title: string;
  startedAt: string; // ISO
  notes: string;
  exercises: LiveExercise[];
  /** Instante (ms desde 1970) em que o descanso termina; null se não há descanso ativo. */
  restEndsAt: number | null;
  restSeconds: number;
  /** Momento (ms) da última alteração feita pelo usuário. */
  updatedAt: number;
  /** Valor de `updatedAt` já gravado no servidor; diferente de `updatedAt` = há alterações pendentes. */
  syncedAt: number | null;
}

export interface PreviousEntry {
  exerciseId?: string | null;
  name: string;
  sets: PreviousSet[];
}

export type UidFactory = () => string;

/* ------------------------------ criação ------------------------------ */

function blankSet(makeUid: UidFactory, weight = '', reps = ''): LiveSet {
  return { uid: makeUid(), type: 'normal', weight, reps, done: false };
}

export interface StartInput {
  workoutId: string | null;
  title: string;
  exercises: WorkoutExercise[];
  /** Alinhado por posição com `exercises` (mesma ordem enviada à API). */
  previous?: (PreviousEntry | null)[];
  /**
   * Séries feitas na última execução concluída desta rotina, alinhadas com `exercises`
   * (null = exercício sem histórico: usa as séries planejadas).
   */
  performed?: (PreviousSet[] | null)[];
}

/** Uma entrada de GET /sessions/last-performance/:workoutId. */
export interface ExercisePerformance {
  exerciseId: string | null;
  name: string;
  plannedSets: { weight: number; reps: number }[];
  source: 'last_session' | 'routine';
  performedAt: string | null;
  sets: PreviousSet[];
}

/** Uma rotina em GET /sessions/last-performance (todas as rotinas do usuário). */
export interface RoutinePerformance {
  workoutId: string;
  exercises: ExercisePerformance[];
}

export interface ReferenceSets {
  source: 'last_session' | 'routine';
  performedAt: string | null;
  sets: { type: string; weight: number; reps: number }[];
}

/**
 * Séries a exibir para um exercício da rotina: as da referência do servidor (a mesma usada ao
 * iniciar o treino) quando ela corresponde a este exercício; caso contrário, as planejadas.
 */
export function referenceSetsFor(
  exercise: WorkoutExercise,
  index: number,
  performance: ExercisePerformance[] | undefined,
): ReferenceSets {
  const match = performance?.[index];
  if (
    match &&
    (match.exerciseId ?? null) === (exercise.exerciseId ?? null) &&
    match.name === exercise.name &&
    match.sets.length > 0
  ) {
    return { source: match.source, performedAt: match.performedAt, sets: match.sets };
  }
  return {
    source: 'routine',
    performedAt: null,
    sets: (exercise.sets ?? []).map((set) => ({ type: 'normal', weight: set.weight, reps: set.reps })),
  };
}

/**
 * Monta a entrada de startSession a partir da referência calculada no servidor: a lista de
 * exercícios é a da rotina (no banco), e as séries vêm do último treino concluído quando houver.
 */
export function startInputFromPerformance(
  workoutId: string,
  title: string,
  performance: ExercisePerformance[],
): StartInput {
  return {
    workoutId,
    title,
    exercises: performance.map((exercise) => ({
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets: exercise.plannedSets,
    })),
    performed: performance.map((exercise) =>
      exercise.source === 'last_session' && exercise.sets.length > 0 ? exercise.sets : null,
    ),
  };
}

/** Cria a sessão a partir de uma rotina: cada série planejada vira uma série a cumprir. */
export function startSession(input: StartInput, makeUid: UidFactory, nowIso: string): LiveSession {
  const exercises: LiveExercise[] = input.exercises.map((exercise, index) => {
    const uid = makeUid();
    const planned = exercise.sets ?? [];
    const performed = input.performed?.[index];
    // Referência: o que foi FEITO na última execução (progressão de carga); sem histórico, o planejado.
    const sets =
      performed && performed.length > 0
        ? performed.map((set) => ({
            ...blankSet(makeUid, String(set.weight), String(set.reps)),
            type: isSetType(set.type) ? set.type : ('normal' as const),
          }))
        : planned.length > 0
          ? planned.map((set) => blankSet(makeUid, String(set.weight), String(set.reps)))
          : [blankSet(makeUid)];
    return {
      uid,
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets,
      previous: input.previous?.[index]?.sets ?? performed ?? [],
    };
  });
  return {
    localId: makeUid(),
    serverId: null,
    origin: input.workoutId ? 'planned' : 'free',
    workoutId: input.workoutId,
    title: input.title,
    startedAt: nowIso,
    notes: '',
    exercises,
    restEndsAt: null,
    restSeconds: DEFAULT_REST_SECONDS,
    updatedAt: Date.parse(nowIso),
    syncedAt: null,
  };
}

/** Treino livre: começa sem exercícios e sem vínculo com treino planejado. */
export function startEmptySession(makeUid: UidFactory, nowIso: string, title = 'Treino livre'): LiveSession {
  return {
    localId: makeUid(),
    serverId: null,
    origin: 'free',
    workoutId: null,
    title,
    startedAt: nowIso,
    notes: '',
    exercises: [],
    restEndsAt: null,
    restSeconds: DEFAULT_REST_SECONDS,
    updatedAt: Date.parse(nowIso),
    syncedAt: null,
  };
}

/** Marca a sessão como alterada (precisa ser sincronizada). Mantém a referência se nada mudou. */
export function touchSession(previous: LiveSession, next: LiveSession, nowMs: number): LiveSession {
  return next === previous ? previous : { ...next, updatedAt: Math.max(nowMs, previous.updatedAt + 1) };
}

export function hasPendingSync(session: LiveSession): boolean {
  return session.serverId === null || session.syncedAt !== session.updatedAt;
}

/* ------------------------------ edição ------------------------------- */

function mapExercise(
  session: LiveSession,
  exerciseUid: string,
  change: (exercise: LiveExercise) => LiveExercise,
): LiveSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => (exercise.uid === exerciseUid ? change(exercise) : exercise)),
  };
}

function mapSet(
  session: LiveSession,
  exerciseUid: string,
  setUid: string,
  change: (set: LiveSet) => LiveSet,
): LiveSession {
  return mapExercise(session, exerciseUid, (exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => (set.uid === setUid ? change(set) : set)),
  }));
}

export function addExerciseByName(
  session: LiveSession,
  name: string,
  makeUid: UidFactory,
): LiveSession | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: 'Informe o nome do exercício.' };
  const exercise: LiveExercise = { uid: makeUid(), name: trimmed, sets: [blankSet(makeUid)], previous: [] };
  return { ...session, exercises: [...session.exercises, exercise] };
}

export interface CatalogRef {
  id: string;
  name: string;
}

export function countInSession(session: LiveSession, exerciseId: string): number {
  return session.exercises.filter((exercise) => exercise.exerciseId === exerciseId).length;
}

export type AddToSessionResult =
  | { status: 'added'; session: LiveSession }
  | { status: 'duplicate'; session: LiveSession };

/**
 * Adiciona um exercício do catálogo ao FIM da sessão, preservando os anteriores, já com uma
 * série em branco. Se ele já está na sessão, devolve `duplicate` (sem alterar nada) a menos que
 * `allowDuplicate` seja true — repetir o exercício de propósito continua possível.
 */
export function addCatalogExerciseToSession(
  session: LiveSession,
  ref: CatalogRef,
  makeUid: UidFactory,
  options: { allowDuplicate?: boolean } = {},
): AddToSessionResult {
  if (!options.allowDuplicate && countInSession(session, ref.id) > 0) return { status: 'duplicate', session };
  const exercise: LiveExercise = {
    uid: makeUid(),
    exerciseId: ref.id,
    name: ref.name,
    sets: [blankSet(makeUid)],
    previous: [],
  };
  return { status: 'added', session: { ...session, exercises: [...session.exercises, exercise] } };
}

export function moveLiveExercise(session: LiveSession, exerciseUid: string, direction: -1 | 1): LiveSession {
  const index = session.exercises.findIndex((exercise) => exercise.uid === exerciseUid);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= session.exercises.length) return session;
  const exercises = [...session.exercises];
  [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
  return { ...session, exercises };
}

export function removeLiveExercise(session: LiveSession, exerciseUid: string): LiveSession {
  return { ...session, exercises: session.exercises.filter((exercise) => exercise.uid !== exerciseUid) };
}

/** Nova série copiando os valores da última (comum repetir a carga). */
export function addLiveSet(session: LiveSession, exerciseUid: string, makeUid: UidFactory): LiveSession {
  return mapExercise(session, exerciseUid, (exercise) => {
    const last = exercise.sets[exercise.sets.length - 1];
    return { ...exercise, sets: [...exercise.sets, blankSet(makeUid, last?.weight ?? '', last?.reps ?? '')] };
  });
}

export function removeLiveSet(session: LiveSession, exerciseUid: string, setUid: string): LiveSession {
  return mapExercise(session, exerciseUid, (exercise) => ({
    ...exercise,
    sets: exercise.sets.filter((set) => set.uid !== setUid),
  }));
}

export function updateLiveSet(
  session: LiveSession,
  exerciseUid: string,
  setUid: string,
  patch: Partial<Pick<LiveSet, 'weight' | 'reps' | 'type'>>,
): LiveSession {
  // Editar uma série já concluída a reabre: os valores mudaram e precisam ser reconfirmados.
  return mapSet(session, exerciseUid, setUid, (set) => ({ ...set, ...patch, done: patch.type ? set.done : false }));
}

export type SetValues = { weight: number; reps: number } | { error: string };

export function parseSetValues(set: Pick<LiveSet, 'weight' | 'reps'>): SetValues {
  if (set.weight.trim() === '' || set.reps.trim() === '') {
    return { error: 'Preencha peso e repetições para concluir a série (use 0 sem carga).' };
  }
  const weight = Number(set.weight.replace(',', '.'));
  const reps = Number(set.reps);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) return { error: 'Peso inválido.' };
  if (!Number.isInteger(reps) || reps < 1 || reps > 1000) return { error: 'Repetições inválidas.' };
  return { weight, reps };
}

/**
 * Marca/desmarca a série como concluída. Ao concluir, valida os valores e inicia o descanso.
 */
export function toggleSetDone(
  session: LiveSession,
  exerciseUid: string,
  setUid: string,
  nowMs: number,
): LiveSession | { error: string } {
  const target = session.exercises.find((e) => e.uid === exerciseUid)?.sets.find((s) => s.uid === setUid);
  if (!target) return session;

  if (target.done) {
    return mapSet(session, exerciseUid, setUid, (set) => ({ ...set, done: false }));
  }
  const values = parseSetValues(target);
  if ('error' in values) return { error: values.error };

  const next = mapSet(session, exerciseUid, setUid, (set) => ({ ...set, done: true }));
  return { ...next, restEndsAt: nowMs + session.restSeconds * 1000 };
}

/* ------------------------------ descanso ------------------------------ */

export function restRemainingSeconds(session: LiveSession, nowMs: number): number {
  if (session.restEndsAt === null) return 0;
  return Math.max(0, Math.ceil((session.restEndsAt - nowMs) / 1000));
}

export function adjustRest(session: LiveSession, deltaSeconds: number, nowMs: number): LiveSession {
  if (session.restEndsAt === null) return session;
  return { ...session, restEndsAt: Math.max(nowMs, session.restEndsAt + deltaSeconds * 1000) };
}

export function skipRest(session: LiveSession): LiveSession {
  return session.restEndsAt === null ? session : { ...session, restEndsAt: null };
}

export function setRestDuration(session: LiveSession, seconds: number): LiveSession {
  const clamped = Math.min(600, Math.max(10, Math.round(seconds)));
  return { ...session, restSeconds: clamped };
}

/* --------------------------- resumo e término -------------------------- */

export function sessionStats(session: LiveSession) {
  let doneSets = 0;
  let totalSets = 0;
  let volume = 0;
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      totalSets += 1;
      if (!set.done) continue;
      doneSets += 1;
      const values = parseSetValues(set);
      if (!('error' in values) && set.type !== 'warmup') volume += values.weight * values.reps;
    }
  }
  return { doneSets, totalSets, pendingSets: totalSets - doneSets, volume };
}

export function validateFinish(session: LiveSession): string | null {
  return sessionStats(session).doneSets === 0 ? 'Conclua pelo menos uma série antes de finalizar o treino.' : null;
}

/** Estado da tela enviado ao servidor durante o treino (formato aceito por PUT /sessions/:id/progress). */
export interface ProgressPayload {
  title: string;
  notes: string;
  restSeconds: number;
  exercises: {
    uid: string;
    exerciseId?: string;
    name: string;
    sets: { uid: string; type: SetType; weight: string; reps: string; done: boolean }[];
    previous: PreviousSet[];
  }[];
}

export function toProgressPayload(session: LiveSession): ProgressPayload {
  return {
    title: session.title.slice(0, 255),
    notes: session.notes.slice(0, 2000),
    restSeconds: session.restSeconds,
    exercises: session.exercises.map((exercise) => ({
      uid: exercise.uid,
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets: exercise.sets.map((set) => ({
        uid: set.uid,
        type: set.type,
        weight: set.weight.slice(0, 12),
        reps: set.reps.slice(0, 12),
        done: set.done,
      })),
      previous: exercise.previous.map((set) => ({ type: set.type, weight: set.weight, reps: set.reps })),
    })),
  };
}

/** Sessão em andamento como devolvida por GET /sessions/active. */
export interface ServerActiveSession {
  id: string;
  origin: SessionOrigin;
  workoutId: string | null;
  title: string;
  startedAt: string;
  progress: unknown;
}

/** Reconstrói a sessão local a partir da cópia do servidor (retomar após recarregar ou em outro aparelho). */
export function sessionFromServer(server: ServerActiveSession, makeUid: UidFactory, nowMs: number): LiveSession {
  const progress = isRecord(server.progress) ? server.progress : {};
  const title = typeof progress.title === 'string' && progress.title.trim() ? progress.title : server.title;
  const parsed = parseStoredSession(
    { exercises: [], ...progress, startedAt: server.startedAt, workoutId: server.workoutId, title },
    makeUid,
  );
  const base = parsed ?? startEmptySession(makeUid, server.startedAt, server.title);
  return {
    ...base,
    localId: makeUid(),
    serverId: server.id,
    origin: server.origin,
    workoutId: server.workoutId,
    restEndsAt: null,
    updatedAt: nowMs,
    syncedAt: nowMs,
  };
}

/** Corpo de POST /sessions/:id/finish: só as séries realizadas. */
export function toFinishPayload(session: LiveSession, finishedAtIso: string) {
  const { title, finishedAt, notes, exercises } = toSessionPayload(session, finishedAtIso);
  return { title, finishedAt, ...(notes ? { notes } : {}), exercises };
}

export interface SessionPayload {
  workoutId?: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  notes?: string;
  exercises: {
    exerciseId?: string;
    name: string;
    sets: { type: SetType; weight: number; reps: number }[];
  }[];
}

/** Só séries concluídas vão para o histórico; exercícios sem nenhuma são omitidos. */
export function toSessionPayload(session: LiveSession, finishedAtIso: string): SessionPayload {
  const exercises: SessionPayload['exercises'] = [];
  for (const exercise of session.exercises) {
    const sets: SessionPayload['exercises'][number]['sets'] = [];
    for (const set of exercise.sets) {
      if (!set.done) continue;
      const values = parseSetValues(set);
      if ('error' in values) continue;
      sets.push({ type: set.type, weight: values.weight, reps: values.reps });
    }
    if (sets.length === 0) continue;
    exercises.push({
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets,
    });
  }
  return {
    ...(session.workoutId ? { workoutId: session.workoutId } : {}),
    title: session.title.trim() || 'Treino',
    startedAt: session.startedAt,
    finishedAt: finishedAtIso,
    ...(session.notes.trim() ? { notes: session.notes.trim() } : {}),
    exercises,
  };
}

/* ------------------------------ formatação ----------------------------- */

/** 3725 → "1h 02min"; 2700 → "45 min". */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}

/** 75 → "1:15". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "62,5 kg × 8" (vírgula decimal e espaço antes da unidade). */
export function formatPrevious(set: PreviousSet | undefined): string {
  return set ? `${set.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg × ${set.reps}` : '—';
}

/* ---------------------------- leitura defensiva ------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSetType(value: unknown): value is SetType {
  return typeof value === 'string' && (SET_TYPES as readonly string[]).includes(value);
}

export function parseStoredSession(value: unknown, makeUid: UidFactory): LiveSession | null {
  if (!isRecord(value) || typeof value.startedAt !== 'string' || !Array.isArray(value.exercises)) return null;
  if (Number.isNaN(Date.parse(value.startedAt))) return null;

  const exercises: LiveExercise[] = [];
  for (const item of value.exercises) {
    if (!isRecord(item) || typeof item.name !== 'string' || item.name.trim() === '') continue;
    const sets: LiveSet[] = [];
    if (Array.isArray(item.sets)) {
      for (const raw of item.sets) {
        if (!isRecord(raw)) continue;
        sets.push({
          uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : makeUid(),
          type: isSetType(raw.type) ? raw.type : 'normal',
          weight: typeof raw.weight === 'string' ? raw.weight : '',
          reps: typeof raw.reps === 'string' ? raw.reps : '',
          done: raw.done === true,
        });
      }
    }
    const previous: PreviousSet[] = [];
    if (Array.isArray(item.previous)) {
      for (const raw of item.previous) {
        if (isRecord(raw) && typeof raw.weight === 'number' && typeof raw.reps === 'number') {
          previous.push({ type: typeof raw.type === 'string' ? raw.type : 'normal', weight: raw.weight, reps: raw.reps });
        }
      }
    }
    exercises.push({
      uid: typeof item.uid === 'string' && item.uid ? item.uid : makeUid(),
      ...(typeof item.exerciseId === 'string' && item.exerciseId ? { exerciseId: item.exerciseId } : {}),
      name: item.name,
      sets,
      previous,
    });
  }

  const workoutId = typeof value.workoutId === 'string' ? value.workoutId : null;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : Date.parse(value.startedAt);
  return {
    // Sessões gravadas antes da sincronização não têm estes campos: ficam pendentes de envio.
    localId: typeof value.localId === 'string' && value.localId ? value.localId : makeUid(),
    serverId: typeof value.serverId === 'string' && value.serverId ? value.serverId : null,
    origin: value.origin === 'planned' || value.origin === 'free' ? value.origin : workoutId ? 'planned' : 'free',
    workoutId,
    title: typeof value.title === 'string' ? value.title : 'Treino',
    startedAt: value.startedAt,
    notes: typeof value.notes === 'string' ? value.notes : '',
    exercises,
    restEndsAt: typeof value.restEndsAt === 'number' ? value.restEndsAt : null,
    restSeconds:
      typeof value.restSeconds === 'number' && value.restSeconds >= 10 ? value.restSeconds : DEFAULT_REST_SECONDS,
    updatedAt,
    syncedAt: typeof value.syncedAt === 'number' ? value.syncedAt : null,
  };
}
