'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { cx } from '../../../components/cx';
import ui from '../../../components/ui.module.css';
import historyStyles from '../../history/history.module.css';
import LoadChart from '../../../components/LoadChart';
import SessionDetails from '../../../components/SessionDetails';
import { api } from '../../../services/api';
import { formatKg, fullDateLabel, repsLabel, type ExerciseProgress } from '../../../lib/exercise-progress';
import { SET_TYPE_LABEL } from '../../../lib/session';
import { TOKEN_KEY } from '../../../lib/use-workout-draft';
import styles from './progress.module.css';

/** Sessões mais recentes consultadas (o recorde vale para todo o histórico). */
const SESSIONS_LIMIT = 60;

/** useSearchParams exige um limite de Suspense para o build estático (Next 16). */
export default function ExerciseProgressPage() {
  return (
    <Suspense
      fallback={
        <p className={ui.loadingText} role="status">
          Carregando evolução…
        </p>
      }
    >
      <ExerciseProgressView />
    </Suspense>
  );
}

type State =
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string; data: ExerciseProgress }
  | { status: 'error'; id: string; message: string };

function ExerciseProgressView() {
  const router = useRouter();
  const exerciseId = useSearchParams().get('id') ?? '';
  const [state, setState] = useState<State>({ status: 'loading', id: exerciseId });
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      router.replace('/');
      return;
    }
    if (!exerciseId) return;
    let cancelled = false;
    api
      .get<ExerciseProgress>(`/sessions/exercises/${encodeURIComponent(exerciseId)}/progress`, {
        params: { limit: SESSIONS_LIMIT },
      })
      .then((response) => {
        if (!cancelled) setState({ status: 'ready', id: exerciseId, data: response.data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(error);
        const notFound = axios.isAxiosError(error) && error.response?.status === 404;
        setState({
          status: 'error',
          id: exerciseId,
          message: notFound
            ? 'Exercício não encontrado no catálogo nem no seu histórico.'
            : 'Não foi possível carregar a evolução. Verifique sua conexão e tente novamente.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId, router]);

  const back = (
    <Link href="/exercises" className={styles.back}>
      ← Catálogo
    </Link>
  );

  if (!exerciseId) {
    return (
      <div className={styles.page}>
        {back}
        <div className={ui.bannerError} role="alert">
          Escolha um exercício no catálogo para ver a evolução.
        </div>
      </div>
    );
  }

  if (state.id !== exerciseId || state.status === 'loading') {
    return (
      <div className={styles.page}>
        {back}
        <p className={ui.loadingText} role="status">
          Carregando evolução…
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.page}>
        {back}
        <div className={ui.bannerError} role="alert">
          {state.message}
        </div>
      </div>
    );
  }

  const { data } = state;
  const { record, points, sessions } = data;

  return (
    <div className={styles.page}>
      {back}
      <header>
        <h1 className={cx(ui.pageTitle, styles.title)}>{data.name}</h1>
        <p className={ui.pageSubtitle}>Evolução das suas cargas neste exercício, só com treinos concluídos.</p>
      </header>

      {data.totalSessions === 0 ? (
        <div className={cx(ui.card, ui.emptyState)}>
          <h2 className={ui.sectionTitle}>Ainda sem histórico</h2>
          <p>Quando você concluir um treino com este exercício, a evolução das cargas aparece aqui.</p>
          <div className={styles.emptyActions}>
            <Link href="/train" className={cx(ui.btn, ui.btnPrimary)}>
              Começar treino livre
            </Link>
            <Link href="/dashboard" className={cx(ui.btn, ui.btnSecondary)}>
              Ver minhas rotinas
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className={cx(ui.card, styles.record)} aria-labelledby="record-title">
            <h2 id="record-title" className={styles.cardTitle}>
              🏆 Recorde pessoal
            </h2>
            {record ? (
              <>
                <p className={styles.recordValue}>
                  <strong>{formatKg(record.weight)}</strong>
                  <span>× {repsLabel(record.reps)}</span>
                  {record.type !== 'normal' && <em> · {SET_TYPE_LABEL[record.type]}</em>}
                </p>
                <p className={styles.recordMeta}>
                  {fullDateLabel(record.startedAt)} · {record.title}
                </p>
              </>
            ) : (
              <p className={styles.muted}>
                Nenhuma série com carga registrada (por exemplo, só com o peso do corpo).
              </p>
            )}
          </section>

          <section className={cx(ui.card, styles.chartCard)} aria-labelledby="chart-title">
            <h2 id="chart-title" className={styles.cardTitle}>
              Carga e repetições por sessão
            </h2>
            <p className={styles.note}>
              A série mais pesada de cada treino, pela data de início. Toque no gráfico para escolher uma sessão.
            </p>
            {points.length > 0 ? (
              <LoadChart points={points} sessions={sessions} />
            ) : (
              <p className={styles.muted}>Nenhuma carga registrada para desenhar o gráfico.</p>
            )}
          </section>

          <section className={styles.history} aria-labelledby="history-title">
            <h2 id="history-title" className={cx(ui.sectionTitle, styles.historyTitle)}>
              Histórico do exercício
            </h2>
            {data.totalSessions > sessions.length && (
              <p className={styles.note}>
                Mostrando as {sessions.length} sessões mais recentes de {data.totalSessions}. O recorde considera
                todas.
              </p>
            )}

            {sessions.map((session) => {
              const open = openId === session.sessionId;
              return (
                <article key={session.sessionId} className={cx(ui.card, historyStyles.card)}>
                  <div className={styles.entry}>
                    <span className={historyStyles.titleRow}>
                      <strong>
                        {session.title}
                        <span
                          className={session.origin === 'planned' ? historyStyles.badgePlanned : historyStyles.badgeFree}
                        >
                          {session.origin === 'planned' ? 'Planejado' : 'Livre'}
                        </span>
                      </strong>
                      <small>{fullDateLabel(session.startedAt)}</small>
                    </span>
                    <span className={historyStyles.metrics}>
                      <span>
                        {session.setCount} {session.setCount === 1 ? 'série' : 'séries'}
                      </span>
                      {session.best && (
                        <span>
                          Maior: {formatKg(session.best.weight)} × {session.best.reps}
                        </span>
                      )}
                    </span>
                    <ol className={styles.sets}>
                      {session.sets.map((set, index) => (
                        <li key={index}>
                          {formatKg(set.weight)} × {set.reps}
                          {set.type !== 'normal' && <em> · {SET_TYPE_LABEL[set.type]}</em>}
                        </li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : session.sessionId)}
                    >
                      {open ? 'Ocultar treino completo' : 'Ver treino completo'}
                    </button>
                  </div>
                  {open && (
                    <div className={historyStyles.details}>
                      <SessionDetails sessionId={session.sessionId} />
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
