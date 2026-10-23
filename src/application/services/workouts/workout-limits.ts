/** Quantidade máxima de treinos planejados (modelos) que cada usuário pode manter salvos. */
export const MAX_PLANNED_WORKOUTS = 7;

export interface WorkoutQuota {
  used: number;
  limit: number;
  remaining: number;
}

export function toQuota(used: number): WorkoutQuota {
  return {
    used,
    limit: MAX_PLANNED_WORKOUTS,
    remaining: Math.max(0, MAX_PLANNED_WORKOUTS - used),
  };
}
