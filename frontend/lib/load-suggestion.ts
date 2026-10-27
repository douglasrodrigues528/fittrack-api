/**
 * Sugestão de progressão de carga para a próxima execução de um exercício de rotina.
 *
 * Usa só o que o FitTrack registra: o objetivo planejado na rotina (repetições por série) e as
 * séries feitas no ÚLTIMO treino concluído desta rotina com o exercício (GET
 * /sessions/last-performance/:workoutId). O app não registra esforço percebido nem qualidade de
 * execução; o único sinal de esforço é a série marcada pelo usuário como "Falha".
 *
 * A sugestão é só informativa: nada muda até o usuário escolher aplicá-la, e aplicar altera
 * apenas as séries ainda não feitas da sessão em andamento (nunca a rotina nem o histórico).
 */
import type { ExercisePerformance, LiveExercise, LiveSession, PreviousSet } from './session';

/** Granularidade de carga aceita no app (o campo de kg usa passos de 0,5). */
export const LOAD_STEP_KG = 0.5;
/**
 * Incremento conservador: 5% da maior carga de trabalho, arredondado para 0,5 kg, entre
 * 0,5 kg e 2,5 kg. Ex.: 60 kg → +2,5; 20 kg → +1; 12 kg → +0,5.
 */
export const INCREMENT_RATE = 0.05;
export const MIN_INCREMENT_KG = 0.5;
export const MAX_INCREMENT_KG = 2.5;
/** Limite de carga aceito pela API. */
const MAX_WEIGHT_KG = 1000;

export type LoadSuggestion =
  | {
      kind: 'increase';
      /** Cargas das séries de trabalho no último treino (na ordem feita). */
      lastWeights: number[];
      /** As mesmas séries com o incremento. */
      suggestedWeights: number[];
      increment: number;
      reason: string;
    }
  | { kind: 'maintain'; lastWeights: number[]; reason: string };

/** Séries que contam para o objetivo: tudo menos aquecimento e drop set. */
export function isWorkSet(set: { type: string }): boolean {
  return set.type !== 'warmup' && set.type !== 'drop';
}

const validWeight = (value: number) => Number.isFinite(value) && value >= 0 && value <= MAX_WEIGHT_KG;
const validReps = (value: number) => Number.isInteger(value) && value >= 1 && value <= 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function incrementFor(load: number): number {
  const raw = Math.round((load * INCREMENT_RATE) / LOAD_STEP_KG) * LOAD_STEP_KG;
  return Math.min(MAX_INCREMENT_KG, Math.max(MIN_INCREMENT_KG, raw));
}

const ordinal = (index: number) => `${index + 1}ª`;
const kg = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;

function repsGoalText(planned: { reps: number }[]): string {
  const reps = planned.map((set) => set.reps);
  if (reps.every((value) => value === reps[0])) return `${reps[0]} repetições`;
  const list = reps.join(', ');
  const last = list.lastIndexOf(', ');
  return `${list.slice(0, last)} e ${list.slice(last + 2)} repetições`;
}

/**
 * Avalia a referência de um exercício. Devolve null quando não há base suficiente para
 * recomendar nada (sem histórico nesta rotina, sem objetivo, dados inválidos, só peso corporal).
 */
export function suggestLoad(performance: ExercisePerformance | undefined): LoadSuggestion | null {
  if (!performance || performance.source !== 'last_session') return null;

  const planned = performance.plannedSets ?? [];
  if (planned.length === 0) return null;
  if (!planned.every((set) => validWeight(Number(set.weight)) && validReps(Number(set.reps)))) return null;

  const work: PreviousSet[] = (performance.sets ?? []).filter(isWorkSet);
  if (work.length === 0) return null;
  if (!work.every((set) => validWeight(set.weight) && validReps(set.reps))) return null;
  // Sem carga (peso corporal): não há o que aumentar.
  if (work.some((set) => set.weight === 0)) return null;

  const lastWeights = work.map((set) => set.weight);
  const maintain = (reason: string): LoadSuggestion => ({ kind: 'maintain', lastWeights, reason });

  if (work.length < planned.length) {
    return maintain(
      `No último treino você fez ${work.length} de ${planned.length} séries planejadas. ` +
        'Mantenha a carga até completar todas.',
    );
  }

  const target = work.slice(0, planned.length);
  const shortIndex = target.findIndex((set, index) => set.reps < Number(planned[index].reps));
  if (shortIndex >= 0) {
    const shortCount = target.filter((set, index) => set.reps < Number(planned[index].reps)).length;
    const detail = `${target[shortIndex].reps} de ${planned[shortIndex].reps} repetições na ${ordinal(shortIndex)} série`;
    return maintain(
      shortCount > 1
        ? `No último treino ${shortCount} séries ficaram abaixo do objetivo (ex.: ${detail}). Mantenha a carga.`
        : `No último treino você fez ${detail}. Mantenha a carga até atingir o objetivo.`,
    );
  }

  const failureIndex = target.findIndex((set) => set.type === 'failure');
  if (failureIndex >= 0) {
    return maintain(
      `A ${ordinal(failureIndex)} série do último treino foi marcada como falha. ` +
        'Repita a carga antes de aumentar.',
    );
  }

  // Consistência: a carga não pode ter caído entre as séries mais do que o próprio plano prevê
  // (atingir as repetições baixando o peso não é sinal para aumentar).
  for (let index = 1; index < target.length; index += 1) {
    const plannedStep = Number(planned[index].weight) - Number(planned[0].weight);
    const doneStep = target[index].weight - target[0].weight;
    if (doneStep < plannedStep - 1e-9) {
      return maintain(
        `No último treino a carga variou entre as séries (${kg(target[0].weight)} → ` +
          `${kg(target[index].weight)} na ${ordinal(index)}). Mantenha a carga até completar todas com ela.`,
      );
    }
  }

  const increment = incrementFor(Math.max(...target.map((set) => set.weight)));
  const suggestedWeights = lastWeights.map((weight) => round2(weight + increment));
  if (suggestedWeights.some((weight) => weight > MAX_WEIGHT_KG)) return null;

  return {
    kind: 'increase',
    lastWeights,
    suggestedWeights,
    increment,
    reason:
      `No último treino você completou as ${planned.length} ${planned.length === 1 ? 'série planejada' : 'séries planejadas'} ` +
      `com ${repsGoalText(planned.map((set) => ({ reps: Number(set.reps) })))}, sem falha e sem baixar a carga.`,
  };
}

/* ----------------------- correspondência com a sessão ----------------------- */

function keyOf(exercise: { exerciseId?: string | null; name: string }): string {
  return exercise.exerciseId
    ? `id:${exercise.exerciseId}`
    : `name:${exercise.name.trim().toLocaleLowerCase('pt-BR')}`;
}

/**
 * Associa cada exercício da sessão à referência do MESMO exercício da rotina (por ID do catálogo
 * ou nome, e pela ocorrência quando ele se repete), a mesma regra do servidor. Exercícios
 * acrescentados durante o treino ficam sem referência.
 */
export function performanceByExercise(
  exercises: Pick<LiveExercise, 'uid' | 'exerciseId' | 'name'>[],
  performance: ExercisePerformance[],
): Map<string, ExercisePerformance> {
  const available = new Map<string, ExercisePerformance[]>();
  for (const entry of performance) {
    const key = keyOf(entry);
    available.set(key, [...(available.get(key) ?? []), entry]);
  }
  const seen = new Map<string, number>();
  const result = new Map<string, ExercisePerformance>();
  for (const exercise of exercises) {
    const key = keyOf(exercise);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const match = available.get(key)?.[occurrence];
    if (match) result.set(exercise.uid, match);
  }
  return result;
}

/* ------------------------------ aplicar / estado ----------------------------- */

const weightText = (value: number) => String(value);

/** Troca a carga das séries de trabalho AINDA NÃO FEITAS, posição a posição; o resto fica igual. */
function setPendingWeights(session: LiveSession, exerciseUid: string, weights: number[]): LiveSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => {
      if (exercise.uid !== exerciseUid) return exercise;
      let workIndex = -1;
      return {
        ...exercise,
        sets: exercise.sets.map((set) => {
          if (!isWorkSet(set)) return set;
          workIndex += 1;
          if (set.done || workIndex >= weights.length) return set;
          return { ...set, weight: weightText(weights[workIndex]) };
        }),
      };
    }),
  };
}

/** Aplica a carga sugerida (só quando o usuário escolhe). */
export function applySuggestion(
  session: LiveSession,
  exerciseUid: string,
  suggestion: Extract<LoadSuggestion, { kind: 'increase' }>,
): LiveSession {
  return setPendingWeights(session, exerciseUid, suggestion.suggestedWeights);
}

/** Desfaz: volta as séries não feitas para a carga do último treino. */
export function revertSuggestion(
  session: LiveSession,
  exerciseUid: string,
  suggestion: Extract<LoadSuggestion, { kind: 'increase' }>,
): LiveSession {
  return setPendingWeights(session, exerciseUid, suggestion.lastWeights);
}

/**
 * Situação do exercício em relação à sugestão de aumento, lida dos valores da própria sessão
 * (o que está salvo), e não de um estado à parte:
 * - `done`: não há séries de trabalho pendentes (nada a sugerir);
 * - `applied`: todas as séries pendentes já estão com a carga sugerida;
 * - `pending`: ainda não aplicada.
 */
export function suggestionState(
  exercise: Pick<LiveExercise, 'sets'>,
  suggestion: Extract<LoadSuggestion, { kind: 'increase' }>,
): 'done' | 'applied' | 'pending' {
  const pending: { index: number; weight: number }[] = [];
  let workIndex = -1;
  for (const set of exercise.sets) {
    if (!isWorkSet(set)) continue;
    workIndex += 1;
    if (!set.done && workIndex < suggestion.suggestedWeights.length) {
      pending.push({ index: workIndex, weight: Number(set.weight.replace(',', '.')) });
    }
  }
  if (pending.length === 0) return 'done';
  return pending.every(({ index, weight }) => Math.abs(weight - suggestion.suggestedWeights[index]) < 1e-9)
    ? 'applied'
    : 'pending';
}

/** "60 kg" ou "40–45 kg" quando as séries têm cargas diferentes. */
export function weightRangeLabel(weights: number[]): string {
  const low = Math.min(...weights);
  const high = Math.max(...weights);
  return low === high ? kg(low) : `${low.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}–${kg(high)}`;
}
