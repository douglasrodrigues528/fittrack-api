'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { api } from '../../services/api';
import { catalogLabel, sortByLabel } from '../../lib/catalog-labels';
import { progressPath } from '../../lib/exercise-progress';
import { addCatalogExerciseToSession, countInSession, startEmptySession } from '../../lib/session';
import { beginLiveSession } from '../../lib/session-sync';
import { editLive, liveStore, useLiveSession } from '../../lib/use-live-session';
import { draftStore, makeUid, TOKEN_KEY, useWorkoutDraft } from '../../lib/use-workout-draft';
import { addCatalogExercise, countOccurrences, isDraftEmpty } from '../../lib/workout-draft';
import styles from './exercises.module.css';

type Exercise = {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string | null;
  images: string[];
  imageUrls: string[];
};

type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ExerciseListResponse = {
  data: Exercise[];
  pagination: Pagination;
};

type ExerciseFilters = {
  q: string;
  muscle: string;
  equipment: string;
  level: string;
  category: string;
};

const EMPTY_FILTERS: ExerciseFilters = {
  q: '',
  muscle: '',
  equipment: '',
  level: '',
  category: '',
};

const PAGE_SIZE = 24;

type FilterOptions = { muscles: string[]; equipment: string[] };

/** Onde o exercício escolhido entra: no treino em andamento ou no treino planejado em montagem. */
type Target = 'session' | 'draft';

/** useSearchParams exige um limite de Suspense para o build estático (Next 16). */
export default function ExercisesPage() {
  return (
    <Suspense
      fallback={
        <p className={ui.loadingText} role="status">
          Carregando catálogo…
        </p>
      }
    >
      <ExercisesCatalog />
    </Suspense>
  );
}

function ExercisesCatalog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantsSession = searchParams.get('destino') === 'treino';
  const live = useLiveSession();
  const [targetChoice, setTargetChoice] = useState<Target | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ muscles: [], equipment: [] });
  const [draftFilters, setDraftFilters] = useState<ExerciseFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ExerciseFilters>(EMPTY_FILTERS);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: PAGE_SIZE,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const draft = useWorkoutDraft();
  // Com treino em andamento, o padrão é adicionar nele (a menos que o usuário esteja montando uma rotina).
  const target: Target = live
    ? (targetChoice ?? (wantsSession || isDraftEmpty(draft) ? 'session' : 'draft'))
    : 'draft';

  const loadExercises = useCallback(
    async (targetPage: number, filters: ExerciseFilters) => {
      setLoading(true);
      setError('');

      const params: Record<string, string | number> = {
        page: targetPage,
        limit: PAGE_SIZE,
      };

      for (const key of Object.keys(filters) as (keyof ExerciseFilters)[]) {
        const value = filters[key].trim();
        if (value) params[key] = value;
      }

      try {
        const response = await api.get<ExerciseListResponse>('/exercises', { params });
        setExercises(response.data.data ?? []);
        setPagination(
          response.data.pagination ?? {
            total: response.data.data?.length ?? 0,
            page: targetPage,
            limit: PAGE_SIZE,
            totalPages: 1,
          },
        );
        setAppliedFilters(filters);
      } catch (requestError) {
        console.error('Erro ao carregar catálogo de exercícios:', requestError);
        setError(
          'Não foi possível carregar o catálogo. Confira se a API está rodando e se sua sessão continua ativa.',
        );
        setExercises([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      router.replace('/');
      return;
    }
    // Carga inicial: estado atualizado só nos callbacks da requisição (`loading` já nasce true).
    let cancelled = false;
    api
      .get<FilterOptions>('/exercises/filters')
      .then((response) => {
        if (cancelled) return;
        setFilterOptions({
          muscles: sortByLabel(response.data.muscles ?? []),
          equipment: sortByLabel(response.data.equipment ?? []),
        });
      })
      .catch((requestError: unknown) => console.warn('Filtros indisponíveis; usando campos de texto.', requestError));
    api
      .get<ExerciseListResponse>('/exercises', { params: { page: 1, limit: PAGE_SIZE } })
      .then((response) => {
        if (cancelled) return;
        setExercises(response.data.data ?? []);
        setPagination(
          response.data.pagination ?? {
            total: response.data.data?.length ?? 0,
            page: 1,
            limit: PAGE_SIZE,
            totalPages: 1,
          },
        );
        setAppliedFilters(EMPTY_FILTERS);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        console.error('Erro ao carregar catálogo de exercícios:', requestError);
        setError(
          'Não foi possível carregar o catálogo. Confira se a API está rodando e se sua sessão continua ativa.',
        );
        setExercises([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadExercises(1, draftFilters);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    void loadExercises(1, EMPTY_FILTERS);
  }

  /**
   * Treino em andamento: o exercício entra no fim da sessão, já com uma série para preencher.
   * Os exercícios anteriores são preservados; repetir um exercício pede confirmação.
   */
  function addToSession(exercise: Exercise) {
    const current = liveStore.getSnapshot();
    if (!current) return;
    const ref = { id: exercise.id, name: exercise.name };
    let result = addCatalogExerciseToSession(current, ref, makeUid);
    if (result.status === 'duplicate') {
      const addAgain = window.confirm(
        `"${exercise.name}" já está no treino em andamento. Adicionar novamente (por exemplo, em outro bloco)?`,
      );
      if (!addAgain) return;
      result = addCatalogExerciseToSession(liveStore.getSnapshot() ?? current, ref, makeUid, { allowDuplicate: true });
    }
    const added = result.session;
    editLive(() => added);
    setNotice(
      `"${exercise.name}" adicionado ao treino em andamento. Total: ${added.exercises.length} ` +
        `${added.exercises.length === 1 ? 'exercício' : 'exercícios'}.`,
    );
  }

  function startFreeHere() {
    beginLiveSession(startEmptySession(makeUid, new Date().toISOString()));
    setTargetChoice('session');
    setNotice('Treino livre iniciado. Agora é só tocar em "Adicionar ao treino".');
  }

  /**
   * Insere o exercício direto no rascunho compartilhado do treino (a mesma fonte de
   * dados do dashboard). Não navega: dá para escolher vários exercícios em sequência.
   */
  function chooseExercise(exercise: Exercise) {
    if (target === 'session') {
      addToSession(exercise);
      return;
    }
    const ref = { id: exercise.id, name: exercise.name };
    let result = addCatalogExercise(draftStore.getSnapshot(), ref, makeUid);

    if (result.status === 'duplicate') {
      const addAgain = window.confirm(
        `"${exercise.name}" já está no treino. Adicionar novamente (por exemplo, em outro bloco do treino)?`,
      );
      if (!addAgain) return;
      result = addCatalogExercise(draftStore.getSnapshot(), ref, makeUid, { allowDuplicate: true });
    }

    if (result.status === 'added') {
      const added = result.draft;
      draftStore.update(() => added);
      setNotice(
        `"${exercise.name}" adicionado ao treino. Total no rascunho: ${added.exercises.length}. ` +
          'Defina as séries na tela do treino.',
      );
    }
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={ui.pageTitle}>Catálogo de exercícios</h1>
        <p className={ui.pageSubtitle}>
          Encontre exercícios, consulte a execução e adicione quantos quiser ao seu treino.
        </p>
      </header>

      {live ? (
        <section className={cx(ui.card, styles.targetPanel)} aria-label="Destino dos exercícios">
          <span className={styles.targetLabel}>Adicionar exercícios em:</span>
          <div className={styles.targetToggle} role="group">
            <button
              type="button"
              className={cx(styles.targetOption, target === 'session' && styles.targetOptionOn)}
              aria-pressed={target === 'session'}
              onClick={() => setTargetChoice('session')}
            >
              ⚡ Treino em andamento
            </button>
            <button
              type="button"
              className={cx(styles.targetOption, target === 'draft' && styles.targetOptionOn)}
              aria-pressed={target === 'draft'}
              onClick={() => setTargetChoice('draft')}
            >
              📋 {draft.editingId ? 'Treino em edição' : 'Treino planejado'}
            </button>
          </div>
        </section>
      ) : (
        wantsSession && (
          <div className={ui.bannerInfo} role="status">
            Nenhum treino em andamento.{' '}
            <button type="button" className={cx(ui.btn, ui.btnPrimary, styles.inlineBtn)} onClick={startFreeHere}>
              Começar treino livre
            </button>
          </div>
        )
      )}

      <section className={cx(ui.card, styles.searchPanel)} aria-label="Filtros de exercícios">
        <form onSubmit={handleSearch}>
          <div className={styles.filterGrid}>
            <label className={cx(ui.fieldLabel, styles.searchField)}>
              Pesquisar
              <input
                className={ui.control}
                type="search"
                value={draftFilters.q}
                onChange={(event) => setDraftFilters({ ...draftFilters, q: event.target.value })}
                placeholder="Ex.: supino, agachamento..."
              />
            </label>
            <label className={ui.fieldLabel}>
              Músculo
              {filterOptions.muscles.length > 0 ? (
                <select
                  className={ui.control}
                  value={draftFilters.muscle}
                  onChange={(event) => setDraftFilters({ ...draftFilters, muscle: event.target.value })}
                >
                  <option value="">Todos</option>
                  {filterOptions.muscles.map((muscle) => (
                    <option key={muscle} value={muscle}>
                      {catalogLabel(muscle)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={ui.control}
                  value={draftFilters.muscle}
                  onChange={(event) => setDraftFilters({ ...draftFilters, muscle: event.target.value })}
                  placeholder="Ex.: peito"
                />
              )}
            </label>
            <label className={ui.fieldLabel}>
              Equipamento
              {filterOptions.equipment.length > 0 ? (
                <select
                  className={ui.control}
                  value={draftFilters.equipment}
                  onChange={(event) => setDraftFilters({ ...draftFilters, equipment: event.target.value })}
                >
                  <option value="">Todos</option>
                  {filterOptions.equipment.map((item) => (
                    <option key={item} value={item}>
                      {catalogLabel(item)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={ui.control}
                  value={draftFilters.equipment}
                  onChange={(event) => setDraftFilters({ ...draftFilters, equipment: event.target.value })}
                  placeholder="Ex.: halteres"
                />
              )}
            </label>
            <label className={ui.fieldLabel}>
              Nível
              <input
                className={ui.control}
                value={draftFilters.level}
                onChange={(event) => setDraftFilters({ ...draftFilters, level: event.target.value })}
                placeholder="Ex.: iniciante"
              />
            </label>
          </div>
          <div className={styles.filterActions}>
            <button className={cx(ui.btn, ui.btnPrimary)} type="submit" disabled={loading}>
              {loading ? 'Buscando...' : 'Buscar exercícios'}
            </button>
            <button className={cx(ui.btn, ui.btnSecondary)} type="button" onClick={clearFilters} disabled={loading}>
              Limpar filtros
            </button>
          </div>
        </form>
      </section>

      <div className={styles.resultsBar} role="status">
        <p>
          {loading
            ? 'Carregando catálogo...'
            : `${pagination.total.toLocaleString('pt-BR')} exercícios encontrados`}
        </p>
        {!loading && pagination.totalPages > 0 && (
          <span>
            Página {pagination.page} de {pagination.totalPages}
          </span>
        )}
      </div>

      {error && (
        <div className={ui.bannerError} role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className={ui.bannerSuccess} role="status">
          {notice}
        </div>
      )}

      {!error && !loading && exercises.length === 0 && (
        <div className={cx(ui.card, ui.emptyState)}>
          <h2 className={ui.sectionTitle}>Nenhum exercício encontrado</h2>
          <p>Tente outro nome ou remova algum filtro.</p>
        </div>
      )}

      <section className={styles.exerciseGrid} aria-label="Resultados do catálogo">
        {exercises.map((exercise) => {
          const inWorkout =
            target === 'session' && live ? countInSession(live, exercise.id) : countOccurrences(draft, exercise.id);
          return (
            <article key={exercise.id} className={cx(ui.card, styles.exerciseCard)}>
              <div className={styles.imageFrame}>
                {exercise.imageUrls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={exercise.imageUrls[0]}
                    alt={`Demonstração de ${exercise.name}`}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                ) : (
                  <div className={styles.imageFallback}>Sem imagem disponível</div>
                )}
              </div>

              <div className={styles.cardContent}>
                <div className={styles.cardTitleRow}>
                  <h2>{exercise.name}</h2>
                  {exercise.level && <span className={styles.levelTag}>{exercise.level}</span>}
                </div>

                <div className={styles.metadata}>
                  {exercise.primaryMuscles?.length > 0 && (
                    <p><strong>Músculos principais:</strong> {exercise.primaryMuscles.map(catalogLabel).join(', ')}</p>
                  )}
                  {exercise.equipment && <p><strong>Equipamento:</strong> {catalogLabel(exercise.equipment)}</p>}
                  {exercise.category && <p><strong>Categoria:</strong> {exercise.category}</p>}
                </div>

                <details className={styles.instructions}>
                  <summary>Ver instruções</summary>
                  {exercise.instructions?.length ? (
                    <ol>
                      {exercise.instructions.map((instruction, index) => (
                        <li key={`${exercise.id}-step-${index}`}>{instruction}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>Não há instruções disponíveis para este exercício.</p>
                  )}
                  {exercise.secondaryMuscles?.length > 0 && (
                    <p className={styles.secondaryMuscles}>
                      <strong>Músculos secundários:</strong> {exercise.secondaryMuscles.map(catalogLabel).join(', ')}
                    </p>
                  )}
                </details>

                <div className={styles.cardActions}>
                  <button
                    className={cx(ui.btn, ui.btnPrimary, ui.btnBlock)}
                    type="button"
                    onClick={() => chooseExercise(exercise)}
                  >
                    {target === 'session' ? 'Adicionar ao treino em andamento' : 'Adicionar ao treino'}
                  </button>
                  {inWorkout > 0 && (
                    <span className={styles.inWorkoutTag}>
                      ✓ No treino{inWorkout > 1 ? ` ×${inWorkout}` : ''}
                    </span>
                  )}
                  <Link href={progressPath(exercise.id)} className={styles.progressLink}>
                    📈 Ver minha evolução
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {!loading && pagination.totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Paginação do catálogo">
          <button
            type="button"
            className={cx(ui.btn, ui.btnSecondary)}
            disabled={pagination.page <= 1}
            onClick={() => void loadExercises(pagination.page - 1, appliedFilters)}
          >
            Página anterior
          </button>
          <span>
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            className={cx(ui.btn, ui.btnSecondary)}
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => void loadExercises(pagination.page + 1, appliedFilters)}
          >
            Próxima página
          </button>
        </nav>
      )}

      {target === 'session' && live ? (
        <div className={styles.draftBar} role="region" aria-label="Treino em andamento">
          <span>
            Treino em andamento:{' '}
            <strong>
              {live.exercises.length} {live.exercises.length === 1 ? 'exercício' : 'exercícios'}
            </strong>
          </span>
          <Link href="/train" className={styles.draftBarLink}>
            Voltar ao treino →
          </Link>
        </div>
      ) : draft.exercises.length > 0 && (
        <div className={styles.draftBar} role="region" aria-label="Treino planejado em montagem">
          <span>
            {draft.editingId ? 'Editando treino' : 'Novo treino'}:{' '}
            <strong>
              {draft.exercises.length} {draft.exercises.length === 1 ? 'exercício' : 'exercícios'}
            </strong>
          </span>
          <Link href="/dashboard#workout-form" className={styles.draftBarLink}>
            Ver treino e definir séries →
          </Link>
        </div>
      )}

      <footer className={styles.footer}>
        As imagens são carregadas da base original pela internet. Confira sua disponibilidade antes de cada treino.
      </footer>
    </div>
  );
}
