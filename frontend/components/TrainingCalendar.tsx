'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../services/api';
import { useNow } from '../lib/use-live-session';
import { formatDuration } from '../lib/session';
import { WEEKDAY_LABELS } from '../lib/workout-draft';
import {
  addDays,
  addMonths,
  compareMonths,
  countTrainedDays,
  dayKey,
  fromDayKey,
  groupByDay,
  isFutureDay,
  longDayLabel,
  monthGrid,
  monthNavigation,
  monthTitle,
  rangeFor,
  startOfWeek,
  timeLabel,
  weekDays,
  weekNavigation,
  type CalendarDay,
  type CalendarSession,
  type DayKey,
} from '../lib/calendar';
import SessionDetails from './SessionDetails';
import { cx } from './cx';
import ui from './ui.module.css';
import styles from './TrainingCalendar.module.css';

interface CalendarResponse {
  firstSessionAt: string | null;
  data: CalendarSession[];
}

type View = 'week' | 'month';

/**
 * Dias realmente treinados (sessões CONCLUÍDAS), na semana e no mês. Não usa os dias planejados
 * das rotinas: um dia só é marcado se existe pelo menos uma sessão concluída nele.
 *
 * `mode="week"`: só a semana (dashboard). `mode="full"`: semana e mês, com abas (histórico).
 */
export default function TrainingCalendar({ mode }: { mode: 'week' | 'full' }) {
  // Relógio por minuto: ao virar o dia, "hoje" e a semana atual se atualizam sozinhos.
  const now = useNow(60_000);
  const today = useMemo(() => fromDayKey(dayKey(new Date(now))), [now]);
  const todayKey = dayKey(today);

  const [view, setView] = useState<View>('week');
  // null = acompanhar a data atual; um valor = o usuário navegou para outra semana/mês.
  const [weekAnchor, setWeekAnchor] = useState<DayKey | null>(null);
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number } | null>(null);
  const [selected, setSelected] = useState<DayKey | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  const currentMonth = { year: today.getFullYear(), month: today.getMonth() };
  const shownMonth = monthCursor ?? currentMonth;
  const days: CalendarDay[] = useMemo(
    () =>
      view === 'week'
        ? weekDays(weekAnchor ? fromDayKey(weekAnchor) : today)
        : monthGrid(shownMonth.year, shownMonth.month),
    [view, weekAnchor, today, shownMonth.year, shownMonth.month],
  );
  const range = useMemo(() => rangeFor(days), [days]);
  const rangeKey = `${range.from}|${range.to}`;

  const [result, setResult] = useState<{ key: string; data: CalendarResponse | null; error: boolean } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    api
      .get<CalendarResponse>('/sessions/calendar', { params: range })
      .then((response) => {
        if (!cancelled) setResult({ key: rangeKey, data: response.data, error: false });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setResult({ key: rangeKey, data: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [range, rangeKey]);

  const loading = result?.key !== rangeKey;
  const data = !loading ? result?.data : null;
  const groups = useMemo(() => groupByDay(data?.data ?? []), [data]);

  const firstSessionAt = data?.firstSessionAt ?? null;
  const { canGoBack, canGoForward } =
    view === 'week'
      ? weekNavigation(days[0].key, today, firstSessionAt)
      : monthNavigation(shownMonth, today, firstSessionAt);

  const periodDays = view === 'week' ? days : days.filter((day) => day.inMonth);
  const trainedDays = countTrainedDays(groups, periodDays);
  const sessionCount = periodDays.reduce((total, day) => total + (groups.get(day.key)?.length ?? 0), 0);

  function go(delta: -1 | 1) {
    setSelected(null);
    setOpenSession(null);
    if (view === 'week') {
      const next = dayKey(addDays(days[0].date, delta * 7));
      // Voltar à semana atual retoma o acompanhamento automático da data.
      setWeekAnchor(next === dayKey(startOfWeek(today)) ? null : next);
    } else {
      const next = addMonths(shownMonth.year, shownMonth.month, delta);
      setMonthCursor(compareMonths(next, currentMonth) === 0 ? null : next);
    }
  }

  function backToToday() {
    setWeekAnchor(null);
    setMonthCursor(null);
    setSelected(todayKey);
    setOpenSession(null);
  }

  function selectDay(key: DayKey) {
    setOpenSession(null);
    setSelected((current) => (current === key ? null : key));
  }

  const showingCurrent = view === 'week' ? weekAnchor === null : monthCursor === null;
  const title =
    view === 'week'
      ? `${days[0].date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${days[6].date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`
      : monthTitle(shownMonth.year, shownMonth.month);
  const selectedSessions = selected ? (groups.get(selected) ?? []) : [];

  return (
    <section className={cx(ui.card, styles.calendar)} aria-labelledby="consistency-title">
      <div className={styles.header}>
        <h2 id="consistency-title" className={styles.heading}>
          Consistência
        </h2>
        {mode === 'full' ? (
          <div className={styles.tabs} role="group" aria-label="Período do calendário">
            {(['week', 'month'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={cx(styles.tab, view === option && styles.tabOn)}
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                  setSelected(null);
                  setOpenSession(null);
                }}
              >
                {option === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        ) : (
          <Link href="/history" className={styles.more}>
            Ver calendário
          </Link>
        )}
      </div>

      <div className={styles.nav}>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => go(-1)}
          disabled={!canGoBack}
          aria-label={view === 'week' ? 'Semana anterior' : 'Mês anterior'}
        >
          ‹
        </button>
        <p className={styles.period} aria-live="polite">
          <strong>{title}</strong>
          <span>
            {loading
              ? 'Carregando…'
              : result?.error
                ? 'Não foi possível carregar'
                : `${trainedDays} ${trainedDays === 1 ? 'dia' : 'dias'} com treino` +
                  (sessionCount > trainedDays ? ` · ${sessionCount} treinos` : '')}
          </span>
        </p>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => go(1)}
          disabled={!canGoForward}
          aria-label={view === 'week' ? 'Próxima semana' : 'Próximo mês'}
        >
          ›
        </button>
      </div>

      <div className={cx(styles.grid, view === 'month' && styles.monthGrid)} role="group" aria-label={`Dias de ${title}`}>
        {view === 'month' &&
          WEEKDAY_LABELS.map((label) => (
            <span key={label} className={styles.weekday} aria-hidden="true">
              {label}
            </span>
          ))}
        {days.map((day) => {
          const count = groups.get(day.key)?.length ?? 0;
          const trained = count > 0;
          const future = isFutureDay(day.key, todayKey);
          const isToday = day.key === todayKey;
          const description =
            `${longDayLabel(day.date)}${isToday ? ' (hoje)' : ''}: ` +
            (future
              ? 'data futura'
              : trained
                ? `${count} ${count === 1 ? 'treino concluído' : 'treinos concluídos'}`
                : 'sem treino registrado');
          return (
            <button
              key={day.key}
              type="button"
              className={cx(
                styles.day,
                view === 'month' && !day.inMonth && styles.outside,
                trained && styles.trained,
                isToday && styles.today,
                future && styles.future,
                selected === day.key && styles.selected,
              )}
              aria-label={description}
              aria-pressed={selected === day.key}
              disabled={future || loading}
              onClick={() => selectDay(day.key)}
            >
              {view === 'week' && <span className={styles.dayName}>{WEEKDAY_LABELS[day.date.getDay()]}</span>}
              <span className={styles.dayNumber}>{day.date.getDate()}</span>
              <span className={styles.marker} aria-hidden="true">
                {trained ? (count > 1 ? `×${count}` : '●') : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span className={styles.legend} aria-hidden="true">
          <span className={styles.legendTrained}>●</span> treino concluído
          <span className={styles.legendToday} /> hoje
        </span>
        {!showingCurrent && (
          <button type="button" className={styles.linkBtn} onClick={backToToday}>
            Voltar para hoje
          </button>
        )}
      </div>

      {selected && (
        <div className={styles.dayPanel} aria-live="polite">
          <h3 className={styles.dayTitle}>{longDayLabel(fromDayKey(selected))}</h3>
          {selectedSessions.length === 0 ? (
            <div className={styles.empty}>
              <p>Nenhum treino registrado neste dia.</p>
              {selected === todayKey && (
                <Link href="/train" className={cx(ui.btn, ui.btnPrimary)}>
                  Treinar agora
                </Link>
              )}
            </div>
          ) : (
            <ul className={styles.sessionList}>
              {selectedSessions.map((session) => {
                const open = openSession === session.id;
                return (
                  <li key={session.id} className={styles.sessionItem}>
                    <div className={styles.sessionRow}>
                      <div className={styles.sessionInfo}>
                        <strong>
                          {session.title}
                          <span className={session.origin === 'planned' ? styles.badgePlanned : styles.badgeFree}>
                            {session.origin === 'planned' ? 'Planejado' : 'Livre'}
                          </span>
                        </strong>
                        <span>
                          {timeLabel(session.startedAt)} · ⏱ {formatDuration(session.durationSeconds)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={cx(ui.btn, ui.btnSecondary, styles.detailsBtn)}
                        aria-expanded={open}
                        onClick={() => setOpenSession(open ? null : session.id)}
                      >
                        {open ? 'Ocultar' : 'Ver detalhes'}
                      </button>
                    </div>
                    {open && <SessionDetails sessionId={session.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
