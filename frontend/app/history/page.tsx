'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ui from '../../components/ui.module.css';
import { api } from '../../services/api';
import { TOKEN_KEY } from '../../lib/use-workout-draft';
import { SessionExercises } from '../../components/SessionDetails';
import TrainingCalendar from '../../components/TrainingCalendar';
import { formatDuration, type SetType } from '../../lib/session';
import styles from './history.module.css';

interface HistorySet {
  type: SetType;
  weight: number;
  reps: number;
}

interface HistoryExercise {
  exerciseId: string | null;
  name: string;
  sets: HistorySet[];
}

interface HistorySession {
  id: string;
  origin?: 'planned' | 'free';
  title: string;
  finishedAt: string;
  durationSeconds: number;
  totalSets: number;
  totalVolume: number;
  notes: string | null;
  exercises: HistoryExercise[];
}

interface HistoryResponse {
  data: HistorySession[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

const PAGE_SIZE = 20;

/** useSearchParams exige um limite de Suspense para o build estático (Next 16). */
export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <p className={ui.loadingText} role="status">
          Carregando…
        </p>
      }
    >
      <HistoryList />
    </Suspense>
  );
}

function HistoryList() {
  const router = useRouter();
  const justFinished = useSearchParams().get('concluido') === '1';
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<HistoryResponse>('/sessions', {
        params: { page: targetPage, limit: PAGE_SIZE },
      });
      setSessions((previous) =>
        targetPage === 1 ? response.data.data : [...previous, ...response.data.data],
      );
      setPage(targetPage);
      setTotalPages(response.data.pagination.totalPages);
    } catch (requestError) {
      console.error(requestError);
      setError('Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      router.replace('/');
      return;
    }
    // Carga inicial: estado atualizado só nos callbacks da requisição (`loading` já nasce true).
    let cancelled = false;
    api
      .get<HistoryResponse>('/sessions', { params: { page: 1, limit: PAGE_SIZE } })
      .then((response) => {
        if (cancelled) return;
        setSessions(response.data.data);
        setPage(1);
        setTotalPages(response.data.pagination.totalPages);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        console.error(requestError);
        setError('Não foi possível carregar o histórico. Verifique sua conexão e tente novamente.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleDelete(id: string) {
    if (!window.confirm('Excluir este treino do histórico? Esta ação não pode ser desfeita.')) return;
    try {
      await api.delete(`/sessions/${id}`);
      setSessions((previous) => previous.filter((session) => session.id !== id));
    } catch (requestError) {
      console.error(requestError);
      setError('Não foi possível excluir o treino.');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={ui.pageTitle}>Histórico</h1>

      {justFinished && (
        <div className={ui.bannerSuccess} role="status">
          Treino finalizado e salvo no histórico. Bom trabalho! 💪
        </div>
      )}

      <TrainingCalendar mode="full" />

      {error && (
        <div className={ui.bannerError} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className={`${ui.card} ${ui.emptyState}`}>
          <p>Você ainda não finalizou nenhum treino. Os treinos concluídos aparecem aqui.</p>
          <div className={styles.emptyActions}>
            <Link href="/train" className={`${ui.btn} ${ui.btnPrimary}`}>
              Começar treino livre
            </Link>
            <Link href="/dashboard" className={`${ui.btn} ${ui.btnSecondary}`}>
              Iniciar a partir de uma rotina
            </Link>
          </div>
        </div>
      )}

      {sessions.map((session) => {
        const open = openId === session.id;
        return (
          <article key={session.id} className={`${ui.card} ${styles.card}`}>
            <button
              type="button"
              className={styles.summary}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : session.id)}
            >
              <span className={styles.titleRow}>
                <strong>
                  {session.title}
                  <span className={session.origin === 'planned' ? styles.badgePlanned : styles.badgeFree}>
                    {session.origin === 'planned' ? 'Planejado' : 'Livre'}
                  </span>
                </strong>
                <small>
                  {new Date(session.finishedAt).toLocaleDateString('pt-BR', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                  })}
                </small>
              </span>
              <span className={styles.metrics}>
                <span>⏱ {formatDuration(session.durationSeconds)}</span>
                <span>🏋️ {Math.round(session.totalVolume).toLocaleString('pt-BR')} kg</span>
                <span>{session.totalSets} séries</span>
              </span>
            </button>

            {open && (
              <div className={styles.details}>
                <SessionExercises exercises={session.exercises} notes={session.notes} />
                <button type="button" className={`${ui.btn} ${ui.btnDanger} ${ui.btnBlock}`} onClick={() => void handleDelete(session.id)}>
                  Excluir do histórico
                </button>
              </div>
            )}
          </article>
        );
      })}

      {loading && (
        <p className={ui.loadingText} role="status">
          Carregando…
        </p>
      )}

      {!loading && page < totalPages && (
        <button type="button" className={`${ui.btn} ${ui.btnSecondary} ${ui.btnBlock}`} onClick={() => void load(page + 1)}>
          Carregar mais
        </button>
      )}

    </div>
  );
}
