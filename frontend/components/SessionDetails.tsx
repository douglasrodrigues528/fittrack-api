'use client';

import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { SET_TYPE_LABEL, type SetType } from '../lib/session';
import styles from './SessionDetails.module.css';

export interface SessionDetailExercise {
  exerciseId: string | null;
  name: string;
  sets: { type: SetType; weight: number; reps: number }[];
}

/** Exercícios, séries, repetições e cargas de uma sessão concluída (como no histórico). */
export function SessionExercises({ exercises, notes }: { exercises: SessionDetailExercise[]; notes: string | null }) {
  return (
    <>
      {exercises.map((exercise, index) => (
        <div key={`${exercise.name}-${index}`} className={styles.exercise}>
          <h3>{exercise.name}</h3>
          <ol>
            {exercise.sets.map((set, setIndex) => (
              <li key={setIndex}>
                {set.weight}kg × {set.reps}
                {set.type !== 'normal' && <em> · {SET_TYPE_LABEL[set.type]}</em>}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {notes && <p className={styles.notes}>📝 {notes}</p>}
    </>
  );
}

type Loaded = { exercises: SessionDetailExercise[]; notes: string | null };

/** Busca a sessão na rota de detalhes já existente (GET /sessions/:id) e mostra os exercícios. */
export default function SessionDetails({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ id: string; data: Loaded | null; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Loaded>(`/sessions/${sessionId}`)
      .then((response) => {
        if (!cancelled) setState({ id: sessionId, data: response.data, error: false });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setState({ id: sessionId, data: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!state || state.id !== sessionId) {
    return (
      <p className={styles.status} role="status">
        Carregando treino…
      </p>
    );
  }
  if (state.error || !state.data) {
    return (
      <p className={styles.error} role="alert">
        Não foi possível carregar os detalhes deste treino.
      </p>
    );
  }
  return <SessionExercises exercises={state.data.exercises} notes={state.data.notes} />;
}
