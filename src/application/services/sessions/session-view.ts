/** Funções puras que montam a visão de uma sessão a partir das séries gravadas. */

export interface SetRow {
  exerciseId: string | null;
  exerciseName: string;
  exerciseOrder: number;
  setOrder: number;
  type: string;
  weight: number;
  reps: number;
}

export interface SessionRow {
  id: string;
  workoutId: string | null;
  /** Ausentes em registros antigos (todos concluídos). */
  status?: string | null;
  origin?: string | null;
  title: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationSeconds: number | null;
  notes: string | null;
  sets?: SetRow[];
}

/** Sessões gravadas antes da coluna `origin` existir: com rotina = planejado; sem = livre. */
export function resolveOrigin(session: Pick<SessionRow, 'origin' | 'workoutId'>): 'planned' | 'free' {
  if (session.origin === 'planned' || session.origin === 'free') return session.origin;
  return session.workoutId ? 'planned' : 'free';
}

export interface ViewSet {
  type: string;
  weight: number;
  reps: number;
}

export interface ViewExercise {
  exerciseId: string | null;
  name: string;
  sets: ViewSet[];
}

/** Volume = soma de peso × repetições, sem contar séries de aquecimento. */
export function computeVolume(sets: { type: string; weight: number; reps: number }[]): number {
  return sets
    .filter((set) => set.type !== 'warmup')
    .reduce((total, set) => total + set.weight * set.reps, 0);
}

export function groupExercises(sets: SetRow[]): ViewExercise[] {
  const ordered = [...sets].sort(
    (a, b) => a.exerciseOrder - b.exerciseOrder || a.setOrder - b.setOrder,
  );
  const exercises: ViewExercise[] = [];
  const byOrder = new Map<number, ViewExercise>();
  for (const set of ordered) {
    let exercise = byOrder.get(set.exerciseOrder);
    if (!exercise) {
      exercise = { exerciseId: set.exerciseId, name: set.exerciseName, sets: [] };
      byOrder.set(set.exerciseOrder, exercise);
      exercises.push(exercise);
    }
    exercise.sets.push({ type: set.type, weight: set.weight, reps: set.reps });
  }
  return exercises;
}

export function toSessionView(session: SessionRow) {
  const exercises = groupExercises(session.sets ?? []);
  const allSets = exercises.flatMap((exercise) => exercise.sets);
  return {
    id: session.id,
    workoutId: session.workoutId,
    status: session.status ?? 'completed',
    origin: resolveOrigin(session),
    title: session.title,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationSeconds: session.durationSeconds ?? 0,
    notes: session.notes,
    totalSets: allSets.length,
    totalVolume: computeVolume(allSets),
    exercises,
  };
}
