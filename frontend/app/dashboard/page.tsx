'use client';

import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import styles from './dashboard.module.css';

interface WorkoutSet {
  weight: number;
  reps: number;
}

interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}

interface Workout {
  id: string;
  title: string;
  description: string;
  exercises?: WorkoutExercise[];
  createdAt: string;
}

export default function DashboardPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [exerciseName, setExerciseName] = useState('');
  const [setWeight, setSetWeight] = useState('');
  const [setReps, setSetReps] = useState('');
  const [currentSets, setCurrentSets] = useState<WorkoutSet[]>([]);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (!token) {
      window.location.href = '/';
      return;
    }

    loadWorkouts();
  }, []);

  async function loadWorkouts() {
    try {
      const response = await api.get('/workouts');
      setWorkouts(response.data);
    } catch (error) {
      console.error(error);
    }
  }

  const totalExercises = workouts.reduce(
    (total, workout) => total + (workout.exercises?.length ?? 0),
    0,
  );

  const totalSets = workouts.reduce(
    (total, workout) =>
      total +
      (workout.exercises?.reduce(
        (exerciseTotal, exercise) => exerciseTotal + exercise.sets.length,
        0,
      ) ?? 0),
    0,
  );

  function clearForm() {
    setTitle('');
    setDescription('');
    setEditingId(null);
    setExerciseName('');
    setSetWeight('');
    setSetReps('');
    setCurrentSets([]);
    setExercises([]);
  }

  function handleAddSet() {
    if (!setWeight || !setReps) {
      alert('Informe peso e repetições.');
      return;
    }

    setCurrentSets([
      ...currentSets,
      {
        weight: Number(setWeight),
        reps: Number(setReps),
      },
    ]);

    setSetWeight('');
    setSetReps('');
  }

  function handleAddExercise() {
    if (!exerciseName || currentSets.length === 0) {
      alert('Informe o nome do exercício e pelo menos uma série.');
      return;
    }

    setExercises([
      ...exercises,
      {
        name: exerciseName,
        sets: currentSets,
      },
    ]);

    setExerciseName('');
    setCurrentSets([]);
  }

  async function handleSaveWorkout(e: React.FormEvent) {
    e.preventDefault();

    try {
      if (editingId) {
        await api.patch(`/workouts/${editingId}`, {
          title,
          description,
          exercises,
        });

        alert('Treino atualizado com sucesso!');
      } else {
        await api.post('/workouts', {
          title,
          description,
          exercises,
        });

        alert('Treino cadastrado com sucesso!');
      }

      clearForm();
      loadWorkouts();
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar treino.');
    }
  }

  function handleEditWorkout(workout: Workout) {
    setEditingId(workout.id);
    setTitle(workout.title);
    setDescription(workout.description ?? '');
    setExercises(workout.exercises ?? []);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDeleteWorkout(id: string) {
    const confirmar = window.confirm('Deseja realmente excluir este treino?');

    if (!confirmar) return;

    try {
      await api.delete(`/workouts/${id}`);
      loadWorkouts();
    } catch (error) {
      console.error(error);
      alert('Erro ao excluir treino.');
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>🏋️ FitTrack</h1>
          <p>Gerencie seus treinos, exercícios, séries, cargas e repetições.</p>
        </div>

        <button type="button" className={styles.logoutButton} onClick={handleLogout}>
          Sair
        </button>
      </header>

      <section className={styles.stats}>
        <div className={styles.statCard}>
          <strong>{workouts.length}</strong>
          <span>Treinos</span>
        </div>

        <div className={styles.statCard}>
          <strong>{totalExercises}</strong>
          <span>Exercícios</span>
        </div>

        <div className={styles.statCard}>
          <strong>{totalSets}</strong>
          <span>Séries</span>
        </div>
      </section>

      <section className={styles.formCard}>
        <h2>{editingId ? 'Editar treino' : 'Novo treino'}</h2>

        <form onSubmit={handleSaveWorkout}>
          <input
            className={styles.input}
            placeholder="Título do treino"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <textarea
            className={styles.textarea}
            placeholder="Descrição"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className={styles.exerciseBox}>
            <h3>Adicionar exercício</h3>

            <input
              className={styles.input}
              placeholder="Nome do exercício"
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
            />

            <div className={styles.setInputs}>
              <input
                className={styles.input}
                placeholder="Peso (kg)"
                type="number"
                value={setWeight}
                onChange={(e) => setSetWeight(e.target.value)}
              />

              <input
                className={styles.input}
                placeholder="Repetições"
                type="number"
                value={setReps}
                onChange={(e) => setSetReps(e.target.value)}
              />

              <button type="button" className={styles.secondaryButton} onClick={handleAddSet}>
                + Série
              </button>
            </div>

            {currentSets.length > 0 && (
              <div className={styles.previewBox}>
                <strong>Séries atuais</strong>

                {currentSets.map((set, index) => (
                  <p key={`${set.weight}-${set.reps}-${index}`}>
                    Série {index + 1}: {set.weight}kg × {set.reps} reps
                  </p>
                ))}
              </div>
            )}

            <button type="button" className={styles.primaryButton} onClick={handleAddExercise}>
              + Adicionar Exercício
            </button>
          </div>

          {exercises.length > 0 && (
            <div className={styles.previewBox}>
              <h3>Exercícios adicionados</h3>

              {exercises.map((exercise, index) => (
                <div key={`${exercise.name}-${index}`}>
                  <strong>{exercise.name}</strong>

                  <ul>
                    {exercise.sets.map((set, setIndex) => (
                      <li key={`${set.weight}-${set.reps}-${setIndex}`}>
                        Série {setIndex + 1}: {set.weight}kg × {set.reps} reps
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton}>
              {editingId ? 'Atualizar treino' : 'Salvar treino'}
            </button>

            {editingId && (
              <button type="button" className={styles.secondaryButton} onClick={clearForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section>
        <h2>Meus treinos</h2>

        <div className={styles.cards}>
          {workouts.length === 0 ? (
            <p>Nenhum treino cadastrado.</p>
          ) : (
            workouts.map((workout) => (
              <article key={workout.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3>{workout.title}</h3>
                    <p>{workout.description}</p>
                  </div>

                  <small>
                    {new Date(workout.createdAt).toLocaleDateString('pt-BR')}
                  </small>
                </div>

                {workout.exercises && workout.exercises.length > 0 && (
                  <div className={styles.exerciseList}>
                    {workout.exercises.map((exercise, index) => (
                      <div key={`${exercise.name}-${index}`} className={styles.exerciseCard}>
                        <h4>💪 {exercise.name}</h4>

                        <table className={styles.setTable}>
                          <thead>
                            <tr>
                              <th>Série</th>
                              <th>Peso</th>
                              <th>Reps</th>
                            </tr>
                          </thead>

                          <tbody>
                            {exercise.sets.map((set, setIndex) => (
                              <tr key={`${set.weight}-${set.reps}-${setIndex}`}>
                                <td>{setIndex + 1}</td>
                                <td>{set.weight}kg</td>
                                <td>{set.reps}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.editButton}
                    onClick={() => handleEditWorkout(workout)}
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => handleDeleteWorkout(workout.id)}
                  >
                    Excluir
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}