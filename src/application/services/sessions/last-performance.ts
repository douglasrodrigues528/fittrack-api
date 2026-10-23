/**
 * Valores de referência para a próxima execução de um treino planejado: para cada exercício
 * da rotina, as séries feitas na execução CONCLUÍDA mais recente daquela rotina em que o
 * exercício apareceu. Sem histórico, valem as séries planejadas na rotina.
 *
 * Funções puras: a consulta ao banco fica no SessionsService.
 */
import {
  groupExercises,
  type SetRow,
  type ViewExercise,
  type ViewSet,
} from './session-view';

export interface RoutineExercise {
  exerciseId?: string;
  name: string;
  sets?: { weight: number; reps: number }[] | null;
}

export interface CompletedSessionRows {
  id: string;
  finishedAt: Date;
  sets: SetRow[];
}

export interface ExercisePerformance {
  exerciseId: string | null;
  name: string;
  /** Séries planejadas na rotina (nunca alteradas pelos treinos). */
  plannedSets: { weight: number; reps: number }[];
  /** `last_session`: valores do último treino concluído; `routine`: sem histórico, usa o planejado. */
  source: 'last_session' | 'routine';
  sessionId: string | null;
  performedAt: Date | null;
  /** Séries de referência para a próxima execução. */
  sets: ViewSet[];
}

/**
 * Chave de identidade do exercício. Do catálogo: pelo ID (o nome pode mudar ou se repetir).
 * Exercícios digitados (sem ID, inclusive os de treinos antigos): pelo nome.
 */
function keyOf(exercise: { exerciseId?: string | null; name: string }): string {
  return exercise.exerciseId
    ? `id:${exercise.exerciseId}`
    : `name:${exercise.name.trim().toLocaleLowerCase('pt-BR')}`;
}

export function resolveLastPerformance(
  routine: RoutineExercise[],
  sessions: CompletedSessionRows[],
): ExercisePerformance[] {
  // Mais recente primeiro; em empate de horário, a ordem recebida (já desempatada no banco) prevalece.
  const ordered = sessions
    .map((session, index) => ({ session, index }))
    .sort(
      (a, b) =>
        b.session.finishedAt.getTime() - a.session.finishedAt.getTime() ||
        a.index - b.index,
    )
    .map(({ session }) => ({
      id: session.id,
      finishedAt: session.finishedAt,
      blocks: groupExercises(session.sets),
    }));

  const seen = new Map<string, number>();
  return routine.map((exercise) => {
    const key = keyOf(exercise);
    // O mesmo exercício pode aparecer mais de uma vez na rotina: a k-ésima ocorrência
    // corresponde ao k-ésimo bloco desse exercício no treino realizado.
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    const plannedSets = (exercise.sets ?? []).map((set) => ({
      weight: Number(set.weight),
      reps: Number(set.reps),
    }));

    for (const session of ordered) {
      const block: ViewExercise | undefined = session.blocks.filter(
        (candidate) => keyOf(candidate) === key,
      )[occurrence];
      if (block && block.sets.length > 0) {
        return {
          exerciseId: exercise.exerciseId ?? null,
          name: exercise.name,
          plannedSets,
          source: 'last_session' as const,
          sessionId: session.id,
          performedAt: session.finishedAt,
          sets: block.sets.map((set) => ({
            type: set.type,
            weight: set.weight,
            reps: set.reps,
          })),
        };
      }
    }

    return {
      exerciseId: exercise.exerciseId ?? null,
      name: exercise.name,
      plannedSets,
      source: 'routine' as const,
      sessionId: null,
      performedAt: null,
      sets: plannedSets.map((set) => ({
        type: 'normal',
        weight: set.weight,
        reps: set.reps,
      })),
    };
  });
}
