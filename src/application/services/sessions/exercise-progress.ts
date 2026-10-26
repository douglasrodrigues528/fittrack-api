/**
 * Funções puras da evolução por exercício. Recebem séries de sessões CONCLUÍDAS (o serviço já
 * filtrou usuário, exercício e status) e não alteram nada: é só leitura do histórico.
 *
 * Isto é diferente da referência para a próxima execução (last-performance.ts): aqui interessa
 * a maior carga, lá interessa o último treino feito.
 */

export interface ProgressSetRow {
  sessionId: string;
  exerciseOrder: number;
  setOrder: number;
  type: string;
  weight: number;
  reps: number;
}

export interface ProgressSessionRow {
  id: string;
  workoutId: string | null;
  origin: 'planned' | 'free';
  title: string;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ProgressSet {
  type: string;
  weight: number;
  reps: number;
}

/** Carga válida: peso e repetições positivos (séries só com peso corporal ou zeradas não contam). */
export function isValidLoad(set: { weight: number; reps: number }): boolean {
  return (
    Number.isFinite(set.weight) &&
    set.weight > 0 &&
    Number.isInteger(set.reps) &&
    set.reps > 0
  );
}

/**
 * Série de maior carga. Empate de carga: a de mais repetições; persistindo, a primeira feita.
 * As repetições devolvidas são sempre as da própria série escolhida.
 */
export function bestSet<T extends { weight: number; reps: number }>(
  sets: T[],
): T | null {
  let best: T | null = null;
  for (const set of sets) {
    if (!isValidLoad(set)) continue;
    if (
      !best ||
      set.weight > best.weight ||
      (set.weight === best.weight && set.reps > best.reps)
    ) {
      best = set;
    }
  }
  return best;
}

/**
 * Monta o histórico do exercício (sessão mais recente primeiro, pelo INÍCIO, como o histórico
 * geral) e os pontos do gráfico (mais antiga primeiro), um por sessão com carga válida.
 */
export function buildExerciseProgress(
  sessions: ProgressSessionRow[],
  sets: ProgressSetRow[],
) {
  const bySession = new Map<string, ProgressSetRow[]>();
  for (const set of sets) {
    const list = bySession.get(set.sessionId);
    if (list) list.push(set);
    else bySession.set(set.sessionId, [set]);
  }

  const ordered = [...sessions].sort(
    (a, b) =>
      b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? 1 : -1),
  );

  const history = ordered.map((session) => {
    const rows = (bySession.get(session.id) ?? []).sort(
      (a, b) => a.exerciseOrder - b.exerciseOrder || a.setOrder - b.setOrder,
    );
    const sessionSets: ProgressSet[] = rows.map((row) => ({
      type: row.type,
      weight: row.weight,
      reps: row.reps,
    }));
    const best = bestSet(sessionSets);
    return {
      sessionId: session.id,
      workoutId: session.workoutId,
      origin: session.origin,
      title: session.title,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      setCount: sessionSets.length,
      sets: sessionSets,
      best,
    };
  });

  const points = history
    .filter((entry) => entry.best !== null)
    .reverse()
    .map((entry) => ({
      sessionId: entry.sessionId,
      startedAt: entry.startedAt,
      weight: entry.best!.weight,
      reps: entry.best!.reps,
    }));

  return { sessions: history, points };
}
