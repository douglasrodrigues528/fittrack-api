/** Estado da jornada inicial, vindo de GET /onboarding (persistido no servidor). */

export interface WorkoutQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface JourneyState {
  onboardingCompleted: boolean;
  choice: 'routine' | 'free' | null;
  plannedWorkouts: WorkoutQuota;
  completedSessions: number;
  activeSession: { id: string; title: string; origin: 'planned' | 'free'; startedAt: string } | null;
}

export type OnboardingChoice = 'routine' | 'free';

/** Limite padrão, usado só até a primeira resposta da API (a regra vale no backend). */
export const DEFAULT_WORKOUT_LIMIT = 7;

export function quotaFor(used: number, limit = DEFAULT_WORKOUT_LIMIT): WorkoutQuota {
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** "Você pode criar mais 3 treinos" / "Última vaga" / "Limite atingido". */
export function describeQuota(quota: WorkoutQuota): string {
  if (quota.remaining === 0) return `Limite de ${quota.limit} treinos atingido`;
  if (quota.remaining === 1) return 'Resta 1 vaga';
  return `Restam ${quota.remaining} vagas`;
}

/** Deve mostrar a tela de boas-vindas? Só para quem ainda não começou a usar o app. */
export function shouldShowWelcome(
  journey: JourneyState | null,
  hasWorkouts: boolean,
  hasLiveSession: boolean,
): boolean {
  return journey !== null && !journey.onboardingCompleted && !hasWorkouts && !hasLiveSession;
}
