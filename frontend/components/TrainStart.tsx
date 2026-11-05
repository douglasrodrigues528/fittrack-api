'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import ui from './ui.module.css';
import { api } from '../services/api';
import { startRoutineSession, type StartableRoutine } from '../lib/start-routine';
import { TOKEN_KEY } from '../lib/use-workout-draft';
import { formatWeekdays } from '../lib/workout-draft';
import styles from './TrainStart.module.css';

type Routine = StartableRoutine & { weekdays?: number[] };

/** Tela Treinar sem treino em andamento: iniciar uma rotina, começar livre ou consultar o histórico. */
export default function TrainStart({ onStartFree }: { onStartFree: () => void }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    let cancelled = false;
    api
      .get<Routine[]>('/workouts')
      .then((response) => {
        if (!cancelled) setRoutines(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStart(routine: Routine) {
    setStarting(routine.id);
    const started = await startRoutineSession(routine);
    // Iniciado: a própria página troca esta tela pelo treino, que começa do topo.
    if (started) window.scrollTo(0, 0);
    else setStarting(null);
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={ui.pageTitle}>Treinar</h1>
        <p className={ui.pageSubtitle}>Nenhum treino em andamento. Escolha uma rotina ou comece um treino livre.</p>
      </header>

      <section className={cx(ui.card, styles.panel)} aria-labelledby="train-routines">
        <h2 id="train-routines" className={styles.panelTitle}>
          Suas rotinas
        </h2>
        {failed ? (
          <p className={styles.note} role="alert">
            Não foi possível carregar suas rotinas. Confira a conexão e abra a tela novamente, ou{' '}
            <Link href="/dashboard" className={styles.inlineLink}>
              veja a lista de rotinas
            </Link>
            .
          </p>
        ) : routines === null ? (
          <p className={styles.note} role="status">
            Carregando rotinas…
          </p>
        ) : routines.length === 0 ? (
          <>
            <p className={styles.note}>Você ainda não tem rotinas. Monte uma para iniciar sempre com um toque.</p>
            <Link href="/dashboard#workout-form" className={cx(ui.btn, ui.btnSecondary, ui.btnBlock, styles.createLink)}>
              Criar minha rotina
            </Link>
          </>
        ) : (
          <>
            <ul className={styles.list}>
              {routines.map((routine) => {
                const exerciseCount = routine.exercises?.length ?? 0;
                return (
                  <li key={routine.id} className={styles.row}>
                    <div className={styles.rowText}>
                      <strong>{routine.title}</strong>
                      <span>
                        {exerciseCount} {exerciseCount === 1 ? 'exercício' : 'exercícios'}
                        {routine.weekdays && routine.weekdays.length > 0 && ` · ${formatWeekdays(routine.weekdays)}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.btnPrimary, styles.startBtn)}
                      aria-label={`Iniciar ${routine.title}`}
                      disabled={starting !== null}
                      onClick={() => void handleStart(routine)}
                    >
                      {starting === routine.id ? 'Abrindo…' : '▶ Iniciar'}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Link href="/dashboard" className={styles.manageLink}>
              Gerenciar rotinas
            </Link>
          </>
        )}
      </section>

      <section className={cx(ui.card, styles.panel)} aria-labelledby="train-free">
        <h2 id="train-free" className={styles.panelTitle}>
          Treino livre
        </h2>
        <p className={styles.note}>Escolha os exercícios na hora. Não ocupa vaga de rotina.</p>
        <button
          type="button"
          className={cx(ui.btn, ui.btnBlock, styles.freeBtn)}
          disabled={starting !== null}
          onClick={onStartFree}
        >
          ⚡ Começar treino livre
        </button>
      </section>

      <Link href="/history" className={styles.historyLink}>
        Ver histórico de treinos →
      </Link>
    </div>
  );
}
