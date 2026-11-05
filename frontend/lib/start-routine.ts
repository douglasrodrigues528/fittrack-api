import { api } from '../services/api';
import { beginLiveSession, discardLiveSession } from './session-sync';
import {
  startInputFromPerformance,
  startSession,
  type ExercisePerformance,
  type StartInput,
} from './session';
import { liveStore } from './use-live-session';
import { makeUid } from './use-workout-draft';
import type { WorkoutExercise } from './workout-draft';

/** O que é preciso de uma rotina para iniciar um treino com ela. */
export interface StartableRoutine {
  id: string;
  title: string;
  exercises?: WorkoutExercise[];
}

/**
 * Inicia um treino a partir da rotina; busca as últimas cargas para servir de referência.
 * Único caminho de início de treino planejado (dashboard e tela Treinar).
 * Devolve false se o usuário desistiu em uma das confirmações.
 */
export async function startRoutineSession(routine: StartableRoutine): Promise<boolean> {
  const current = liveStore.getSnapshot();
  if (current) {
    if (!window.confirm(`Já existe um treino em andamento ("${current.title}"). Descartá-lo e iniciar este?`)) {
      return false;
    }
    await discardLiveSession();
  }
  // Referência calculada no servidor: séries e cargas do último treino concluído DESTA rotina,
  // por exercício (ou as planejadas, para exercícios ainda sem histórico).
  let input: StartInput;
  try {
    const response = await api.get<{ title: string; exercises: ExercisePerformance[] }>(
      `/sessions/last-performance/${routine.id}`,
    );
    input = startInputFromPerformance(routine.id, response.data.title, response.data.exercises);
  } catch (error) {
    console.warn('Não foi possível buscar as cargas do último treino.', error);
    if (
      !window.confirm(
        'Não foi possível carregar as cargas do seu último treino (sem conexão?). ' +
          'Iniciar com os valores planejados na rotina?',
      )
    ) {
      return false;
    }
    input = { workoutId: routine.id, title: routine.title, exercises: routine.exercises ?? [] };
  }
  // Inicia uma SESSÃO a partir do modelo: a rotina não é copiada nem alterada.
  beginLiveSession(startSession(input, makeUid, new Date().toISOString()));
  return true;
}
