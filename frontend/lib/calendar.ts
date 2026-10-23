/**
 * Lógica pura do calendário de consistência. Tudo é calculado no calendário LOCAL do aparelho:
 * a API guarda instantes (UTC) e quem decide em que dia cada treino caiu é o fuso do usuário.
 * Assim um treino às 23:30 não "pula" para o dia seguinte.
 *
 * A semana começa no domingo, como em WEEKDAY_LABELS e nos calendários brasileiros.
 */

/** Dia local no formato AAAA-MM-DD (ordenável como texto). */
export type DayKey = string;

/** Sessão concluída devolvida por GET /sessions/calendar. */
export interface CalendarSession {
  id: string;
  workoutId: string | null;
  origin: 'planned' | 'free';
  title: string;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number;
}

export interface CalendarDay {
  date: Date;
  key: DayKey;
  /** Pertence ao mês exibido (na grade mensal, os dias de borda são de meses vizinhos). */
  inMonth: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Meia-noite local do dia. */
export function fromDayKey(key: DayKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Soma dias no calendário local (seguro em mudanças de horário de verão). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfWeek(date: Date): Date {
  return addDays(date, -date.getDay());
}

export function weekDays(anchor: Date): CalendarDay[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    return { date, key: dayKey(date), inMonth: true };
  });
}

/** Grade do mês: semanas completas (domingo a sábado), 5 ou 6 linhas. `month` vai de 0 a 11. */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(last, 6 - last.getDay());
  const days: CalendarDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push({ date, key: dayKey(date), inMonth: date.getMonth() === month });
  }
  return days;
}

/** Período [from, to) em instantes ISO para a API, cobrindo exatamente os dias informados. */
export function rangeFor(days: CalendarDay[]): { from: string; to: string } {
  return {
    from: days[0].date.toISOString(),
    to: addDays(days[days.length - 1].date, 1).toISOString(),
  };
}

/**
 * Regra única do dia de um treino, usada no calendário e no histórico: a data LOCAL de início
 * (`startedAt`). Um treino das 23:30 de domingo que termina na segunda é de domingo.
 * `finishedAt` serve só para o horário de término e a duração.
 */
export function sessionDayKey(session: { startedAt: string }): DayKey {
  return dayKey(new Date(session.startedAt));
}

/** Data do treino como exibida no histórico ("dom., 18 de out."), pela mesma regra. */
export function sessionDateLabel(session: { startedAt: string }): string {
  return fromDayKey(sessionDayKey(session)).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** Agrupa as sessões pelo dia LOCAL em que começaram, em ordem de horário. */
export function groupByDay(sessions: CalendarSession[]): Map<DayKey, CalendarSession[]> {
  const groups = new Map<DayKey, CalendarSession[]>();
  const ordered = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const session of ordered) {
    const key = sessionDayKey(session);
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }
  return groups;
}

/** Quantos dos dias informados têm pelo menos um treino concluído. */
export function countTrainedDays(groups: Map<DayKey, CalendarSession[]>, days: CalendarDay[]): number {
  return days.filter((day) => (groups.get(day.key)?.length ?? 0) > 0).length;
}

export function isFutureDay(key: DayKey, todayKey: DayKey): boolean {
  return key > todayKey;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** "Outubro de 2026". */
export function monthTitle(year: number, month: number): string {
  const text = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "terça-feira, 10 de setembro". */
export function longDayLabel(date: Date): string {
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Mês mais antigo que vale a pena exibir: o do primeiro treino (ou o atual, sem histórico). */
export function earliestMonth(firstSessionAt: string | null, today: Date): { year: number; month: number } {
  const date = firstSessionAt ? new Date(firstSessionAt) : today;
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function compareMonths(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return a.year - b.year || a.month - b.month;
}

/**
 * Até onde a navegação vai: para trás, até o período do primeiro treino concluído (sem
 * histórico, nada antes do atual); para frente, até o período atual (futuro não tem treinos).
 */
export function weekNavigation(weekStart: DayKey, today: Date, firstSessionAt: string | null) {
  const currentWeekStart = dayKey(startOfWeek(today));
  const firstWeekStart = firstSessionAt ? dayKey(startOfWeek(new Date(firstSessionAt))) : currentWeekStart;
  return { canGoBack: weekStart > firstWeekStart, canGoForward: weekStart < currentWeekStart };
}

export function monthNavigation(
  shown: { year: number; month: number },
  today: Date,
  firstSessionAt: string | null,
) {
  const current = { year: today.getFullYear(), month: today.getMonth() };
  return {
    canGoBack: compareMonths(shown, earliestMonth(firstSessionAt, today)) > 0,
    canGoForward: compareMonths(shown, current) < 0,
  };
}

/** "18:05". */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
