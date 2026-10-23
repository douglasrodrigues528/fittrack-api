/**
 * Lógica pura (sem React, sem localStorage) do rascunho de treino.
 * Tudo aqui é imutável: cada função devolve um novo rascunho.
 */

export interface WorkoutSet {
  weight: number;
  reps: number;
}

/** Formato trocado com a API (e armazenado no JSONB). Não contém `uid`. */
export interface WorkoutExercise {
  exerciseId?: string;
  name: string;
  sets: WorkoutSet[];
}

/** Exercício dentro do rascunho: ganha um `uid` local, estável, usado só no frontend. */
export interface DraftExercise extends WorkoutExercise {
  uid: string;
}

export interface WorkoutDraft {
  editingId: string | null;
  title: string;
  description: string;
  exercises: DraftExercise[];
  /** Dias da semana (0 = domingo … 6 = sábado). Opcional: vazio = sem dia fixo. */
  weekdays: number[];
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** [1, 3, 5] → "Seg, Qua e Sex". */
export function formatWeekdays(weekdays: readonly number[] | null | undefined): string {
  const names = normalizeWeekdays(weekdays ?? []).map((day) => WEEKDAY_LABELS[day]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

export function toggleWeekday(draft: WorkoutDraft, day: number): WorkoutDraft {
  const weekdays = draft.weekdays.includes(day)
    ? draft.weekdays.filter((value) => value !== day)
    : normalizeWeekdays([...draft.weekdays, day]);
  return { ...draft, weekdays };
}

export interface CatalogExerciseRef {
  id: string;
  name: string;
}

export interface WorkoutPayload {
  title: string;
  description: string;
  exercises: WorkoutExercise[];
  weekdays: number[];
}

export type UidFactory = () => string;

export function emptyDraft(): WorkoutDraft {
  return { editingId: null, title: '', description: '', exercises: [], weekdays: [] };
}

export function isDraftEmpty(draft: WorkoutDraft): boolean {
  return (
    draft.editingId === null &&
    draft.title.trim() === '' &&
    draft.description.trim() === '' &&
    draft.exercises.length === 0 &&
    draft.weekdays.length === 0
  );
}

/* ----------------------------- exercícios ----------------------------- */

export function countOccurrences(draft: WorkoutDraft, exerciseId: string): number {
  return draft.exercises.filter((exercise) => exercise.exerciseId === exerciseId).length;
}

export type AddExerciseResult =
  | { status: 'added'; draft: WorkoutDraft; uid: string }
  | { status: 'duplicate'; draft: WorkoutDraft };

/**
 * Insere um exercício do catálogo no FIM da lista, preservando todos os demais.
 * Se o mesmo exercício do catálogo já está no rascunho, devolve `duplicate`
 * (sem alterar nada) a menos que `allowDuplicate` seja true — assim a UI pode
 * perguntar ao usuário, e repetir o exercício continua possível quando intencional.
 */
export function addCatalogExercise(
  draft: WorkoutDraft,
  ref: CatalogExerciseRef,
  makeUid: UidFactory,
  options: { allowDuplicate?: boolean } = {},
): AddExerciseResult {
  if (!options.allowDuplicate && countOccurrences(draft, ref.id) > 0) {
    return { status: 'duplicate', draft };
  }
  const uid = makeUid();
  const entry: DraftExercise = { uid, exerciseId: ref.id, name: ref.name, sets: [] };
  return { status: 'added', draft: { ...draft, exercises: [...draft.exercises, entry] }, uid };
}

/** Exercício digitado manualmente (sem vínculo com o catálogo). */
export function addCustomExercise(
  draft: WorkoutDraft,
  name: string,
  makeUid: UidFactory,
): { draft: WorkoutDraft; uid: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: 'Informe o nome do exercício.' };
  const uid = makeUid();
  return {
    draft: { ...draft, exercises: [...draft.exercises, { uid, name: trimmed, sets: [] }] },
    uid,
  };
}

export function removeExercise(draft: WorkoutDraft, uid: string): WorkoutDraft {
  return { ...draft, exercises: draft.exercises.filter((exercise) => exercise.uid !== uid) };
}

export function moveExercise(draft: WorkoutDraft, uid: string, direction: -1 | 1): WorkoutDraft {
  const index = draft.exercises.findIndex((exercise) => exercise.uid === uid);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.exercises.length) return draft;
  const exercises = [...draft.exercises];
  [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
  return { ...draft, exercises };
}

/* -------------------------------- séries ------------------------------- */

export type SetParseResult = { set: WorkoutSet } | { error: string };

/** Converte os textos digitados em uma série válida. Peso 0 é permitido (peso corporal). */
export function parseSetInput(weightText: string, repsText: string): SetParseResult {
  if (weightText.trim() === '' || repsText.trim() === '') {
    return { error: 'Informe o peso e as repetições. Use 0 para exercícios sem carga externa.' };
  }
  const weight = Number(weightText.replace(',', '.'));
  const reps = Number(repsText);
  if (!Number.isFinite(weight) || weight < 0) {
    return { error: 'O peso deve ser 0 ou maior.' };
  }
  if (!Number.isInteger(reps) || reps < 1) {
    return { error: 'As repetições devem ser um número inteiro maior que zero.' };
  }
  return { set: { weight, reps } };
}

function mapExercise(
  draft: WorkoutDraft,
  uid: string,
  change: (exercise: DraftExercise) => DraftExercise,
): WorkoutDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) => (exercise.uid === uid ? change(exercise) : exercise)),
  };
}

export function addSet(draft: WorkoutDraft, uid: string, set: WorkoutSet): WorkoutDraft {
  return mapExercise(draft, uid, (exercise) => ({ ...exercise, sets: [...exercise.sets, { ...set }] }));
}

export function updateSet(
  draft: WorkoutDraft,
  uid: string,
  setIndex: number,
  patch: Partial<WorkoutSet>,
): WorkoutDraft {
  return mapExercise(draft, uid, (exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set, index) => (index === setIndex ? { ...set, ...patch } : set)),
  }));
}

export function removeSet(draft: WorkoutDraft, uid: string, setIndex: number): WorkoutDraft {
  return mapExercise(draft, uid, (exercise) => ({
    ...exercise,
    sets: exercise.sets.filter((_, index) => index !== setIndex),
  }));
}

/* ------------------------- validação e conversão ------------------------ */

export function validateForSave(draft: WorkoutDraft): string[] {
  const errors: string[] = [];
  if (draft.title.trim() === '') errors.push('Informe o título do treino.');

  const withoutSets = draft.exercises.filter((exercise) => exercise.sets.length === 0);
  if (withoutSets.length > 0) {
    errors.push(
      `Adicione pelo menos uma série em: ${withoutSets.map((exercise) => exercise.name).join(', ')}.`,
    );
  }

  const invalidSets = draft.exercises.filter((exercise) =>
    exercise.sets.some(
      (set) =>
        !Number.isFinite(set.weight) ||
        set.weight < 0 ||
        !Number.isInteger(set.reps) ||
        set.reps < 1,
    ),
  );
  if (invalidSets.length > 0) {
    errors.push(
      `Há séries com peso ou repetições inválidos em: ${invalidSets.map((exercise) => exercise.name).join(', ')}.`,
    );
  }
  return errors;
}

/** Monta o corpo enviado à API: remove o `uid` (a API rejeita propriedades desconhecidas). */
export function toPayload(draft: WorkoutDraft): WorkoutPayload {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    exercises: draft.exercises.map((exercise) => ({
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets: exercise.sets.map((set) => ({ weight: set.weight, reps: set.reps })),
    })),
    weekdays: normalizeWeekdays(draft.weekdays),
  };
}

export interface WorkoutLike {
  id: string;
  title: string;
  description?: string | null;
  exercises?: WorkoutExercise[] | null;
  weekdays?: number[] | null;
}

/** Carrega um treino já salvo para edição. Treinos antigos (sem exerciseId) continuam válidos. */
export function draftFromWorkout(workout: WorkoutLike, makeUid: UidFactory): WorkoutDraft {
  return {
    editingId: workout.id,
    title: workout.title,
    description: workout.description ?? '',
    exercises: (workout.exercises ?? []).map((exercise) => ({
      uid: makeUid(),
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets: (exercise.sets ?? []).map((set) => ({ weight: Number(set.weight), reps: Number(set.reps) })),
    })),
    weekdays: normalizeWeekdays(workout.weekdays ?? []),
  };
}

/* --------------------------- leitura defensiva -------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSets(value: unknown): WorkoutSet[] {
  if (!Array.isArray(value)) return [];
  const sets: WorkoutSet[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.weight === 'number' && typeof item.reps === 'number') {
      sets.push({ weight: item.weight, reps: item.reps });
    }
  }
  return sets;
}

/**
 * Reconstrói um rascunho a partir de JSON do localStorage. Aceita o formato atual
 * e o formato antigo (exercícios sem `uid`; campos extras como `currentSets` são ignorados).
 * Devolve null se o valor não for aproveitável.
 */
export function parseStoredDraft(value: unknown, makeUid: UidFactory): WorkoutDraft | null {
  if (!isRecord(value)) return null;
  const exercises: DraftExercise[] = [];
  const usedUids = new Set<string>();
  if (Array.isArray(value.exercises)) {
    for (const item of value.exercises) {
      if (!isRecord(item) || typeof item.name !== 'string' || item.name.trim() === '') continue;
      let uid = typeof item.uid === 'string' && item.uid !== '' ? item.uid : makeUid();
      while (usedUids.has(uid)) uid = makeUid();
      usedUids.add(uid);
      exercises.push({
        uid,
        ...(typeof item.exerciseId === 'string' && item.exerciseId ? { exerciseId: item.exerciseId } : {}),
        name: item.name,
        sets: parseSets(item.sets),
      });
    }
  }
  return {
    editingId: typeof value.editingId === 'string' ? value.editingId : null,
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    exercises,
    weekdays: Array.isArray(value.weekdays)
      ? normalizeWeekdays(value.weekdays.filter((day): day is number => typeof day === 'number'))
      : [],
  };
}
