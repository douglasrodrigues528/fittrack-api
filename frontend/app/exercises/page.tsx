'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { api } from '../../services/api';
import { LEVEL_OPTIONS, catalogLabel, sortByLabel } from '../../lib/catalog-labels';
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

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ExerciseFilters)[];

const PAGE_SIZE = 24;

/** Busca e filtros guardados na URL: voltar da evolução de um exercício reencontra a mesma lista. */
function filtersFromUrl(params: { get(name: string): string | null }): ExerciseFilters {
  const filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = params.get(key) ?? '';
  return filters;
}

function requestParams(page: number, filters: ExerciseFilters): Record<string, string | number> {
  const params: Record<string, string | number> = { page, limit: PAGE_SIZE };
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value) params[key] = value;
  }
  return params;
}

/** Endereço do catálogo para esta busca (`destino` indica para onde vão os exercícios escolhidos). */
function catalogUrl(page: number, filters: ExerciseFilters, destino: string | null): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  if (page > 1) params.set('page', String(page));
  if (destino) params.set('destino', destino);
  const query = params.toString();
  return query ? `/exercises?${query}` : '/exercises';
}

/** Texto de um filtro ativo: o rótulo em português (a busca aparece entre aspas). */
function filterChipLabel(key: keyof ExerciseFilters, value: string): string {
  return key === 'q' ? `“${value}”` : catalogLabel(value);
}

const FILTER_NAME: Record<keyof ExerciseFilters, string> = {
  q: 'Busca',
  muscle: 'Músculo',
  equipment: 'Equipamento',
  level: 'Nível',
  category: 'Categoria',
};

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
  const destino = searchParams.get('destino');
  const wantsSession = destino === 'treino';
  const live = useLiveSession();
  const [targetChoice, setTargetChoice] = useState<Target | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ muscles: [], equipment: [] });
  // A busca da primeira carga vem da URL; depois a URL acompanha o que foi aplicado.
  const [initial] = useState(() => ({
    filters: filtersFromUrl(searchParams),
    page: Math.max(1, Number(searchParams.get('page')) || 1),
  }));
  const [draftFilters, setDraftFilters] = useState<ExerciseFilters>(initial.filters);
  const [appliedFilters, setAppliedFilters] = useState<ExerciseFilters>(initial.filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Exercícios com instruções abertas.
  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(() => new Set());
  const resultsRef = useRef<HTMLDivElement>(null);
  // Só a resposta da busca mais recente vale (filtros aplicam na hora e podem se atropelar).
  const lastRequest = useRef(0);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: initial.page,
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
      const request = ++lastRequest.current;

      try {
        const response = await api.get<ExerciseListResponse>('/exercises', {
          params: requestParams(targetPage, filters),
        });
        if (request !== lastRequest.current) return;
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
        router.replace(catalogUrl(targetPage, filters, destino), { scroll: false });
      } catch (requestError) {
        if (request !== lastRequest.current) return;
        console.error('Erro ao carregar catálogo de exercícios:', requestError);
        setError(
          'Não foi possível carregar o catálogo. Confira se a API está rodando e se sua sessão continua ativa.',
        );
        setExercises([]);
      } finally {
        if (request === lastRequest.current) setLoading(false);
      }
    },
    [router, destino],
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
      .get<ExerciseListResponse>('/exercises', { params: requestParams(initial.page, initial.filters) })
      .then((response) => {
        if (cancelled) return;
        setExercises(response.data.data ?? []);
        setPagination(
          response.data.pagination ?? {
            total: response.data.data?.length ?? 0,
            page: initial.page,
            limit: PAGE_SIZE,
            totalPages: 1,
          },
        );
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
  }, [router, initial]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadExercises(1, draftFilters);
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    void loadExercises(1, EMPTY_FILTERS);
  }

  /** Listas aplicam na hora; digitar só aplica ao buscar (Enter ou botão). */
  function applyFilter(key: keyof ExerciseFilters, value: string) {
    const next = { ...draftFilters, [key]: value };
    setDraftFilters(next);
    void loadExercises(1, next);
  }

  /** Muda de página e leva o usuário ao início da nova lista. */
  async function goToPage(page: number) {
    await loadExercises(page, appliedFilters);
    resultsRef.current?.scrollIntoView({ block: 'start' });
  }

  function toggleDetails(id: string) {
    setOpenDetails((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    setNotice('Treino livre iniciado. Agora é só tocar em "Adicionar".');
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
        `"${exercise.name}" já está na rotina. Adicionar novamente (por exemplo, em outro bloco do treino)?`,
      );
      if (!addAgain) return;
      result = addCatalogExercise(draftStore.getSnapshot(), ref, makeUid, { allowDuplicate: true });
    }

    if (result.status === 'added') {
      const added = result.draft;
      draftStore.update(() => added);
      setNotice(
        `"${exercise.name}" adicionado à rotina. Total no rascunho: ${added.exercises.length}. ` +
          'Defina as séries na tela da rotina.',
      );
    }
  }

  const activeFilters = FILTER_KEYS.filter((key) => appliedFilters[key].trim() !== '');
  const panelFilterCount = activeFilters.filter((key) => key !== 'q').length;
  const hereUrl = catalogUrl(pagination.page, appliedFilters, destino);

  return (
    <div className={styles.page}>
      <h1 className={cx(ui.pageTitle, styles.title)}>Catálogo de exercícios</h1>

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
              📋 {draft.editingId ? 'Rotina em edição' : 'Rotina'}
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

      <section
        className={cx(ui.card, styles.searchPanel, filtersOpen && styles.searchPanelOpen)}
        aria-label="Busca e filtros de exercícios"
      >
        <form onSubmit={handleSearch} className={styles.searchForm}>
          <div className={styles.searchRow}>
            <input
              className={cx(ui.control, styles.searchInput)}
              type="search"
              aria-label="Pesquisar exercícios"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters({ ...draftFilters, q: event.target.value })}
              placeholder="Ex.: supino"
            />
            <button className={cx(ui.btn, ui.btnPrimary, styles.searchBtn)} type="submit" disabled={loading}>
              Buscar
            </button>
            <button
              className={cx(ui.btn, ui.btnSecondary, styles.searchBtn, styles.filterToggle)}
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="catalog-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filtros{panelFilterCount > 0 && ` (${panelFilterCount})`}
            </button>
          </div>
          <div id="catalog-filters" className={styles.filterGrid}>
            <label className={ui.fieldLabel}>
              Músculo
              {filterOptions.muscles.length > 0 ? (
                <select
                  className={ui.control}
                  value={draftFilters.muscle}
                  onChange={(event) => applyFilter('muscle', event.target.value)}
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
                  onChange={(event) => applyFilter('equipment', event.target.value)}
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
              <select
                className={ui.control}
                value={draftFilters.level}
                onChange={(event) => applyFilter('level', event.target.value)}
              >
                <option value="">Todos</option>
                {LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {catalogLabel(level)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </form>
      </section>

      {activeFilters.length > 0 && (
        <div className={styles.activeFilters} role="group" aria-label="Filtros ativos">
          {activeFilters.map((key) => (
            <button
              key={key}
              type="button"
              className={styles.chip}
              aria-label={`Remover ${FILTER_NAME[key].toLowerCase()}: ${filterChipLabel(key, appliedFilters[key])}`}
              onClick={() => applyFilter(key, '')}
            >
              {filterChipLabel(key, appliedFilters[key])} <span aria-hidden="true">✕</span>
            </button>
          ))}
          <button type="button" className={styles.clearBtn} onClick={clearFilters} disabled={loading}>
            Limpar filtros
          </button>
        </div>
      )}

      <div ref={resultsRef} className={styles.resultsBar} role="status">
        <p>
          {loading
            ? 'Carregando catálogo...'
            : `${pagination.total.toLocaleString('pt-BR')} ${pagination.total === 1 ? 'exercício encontrado' : 'exercícios encontrados'}`}
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
          // O que mais pesa na escolha vem primeiro: músculos e equipamento; nível e categoria depois.
          const primaryInfo = [
            exercise.primaryMuscles?.map(catalogLabel).join(', '),
            exercise.equipment && catalogLabel(exercise.equipment),
          ].filter((item): item is string => Boolean(item));
          const secondaryInfo = [
            exercise.level && catalogLabel(exercise.level),
            exercise.category && catalogLabel(exercise.category),
          ].filter((item): item is string => Boolean(item));
          const detailsOpen = openDetails.has(exercise.id);
          const detailsId = `exercise-details-${exercise.id}`;
          return (
            <article key={exercise.id} className={cx(ui.card, styles.exerciseCard)}>
              <div className={styles.cardMain}>
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
                    <div className={styles.imageFallback}>Sem imagem</div>
                  )}
                </div>

                <div className={styles.cardContent}>
                  <h2>{exercise.name}</h2>
                  {primaryInfo.length > 0 && <p className={styles.metaPrimary}>{primaryInfo.join(' · ')}</p>}
                  {secondaryInfo.length > 0 && <p className={styles.metaSecondary}>{secondaryInfo.join(' · ')}</p>}
                  {inWorkout > 0 && (
                    <p className={styles.inWorkoutTag}>
                      {target === 'session' ? '✓ No treino' : '✓ Na rotina'}
                      {inWorkout > 1 ? ` ×${inWorkout}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className={styles.cardActions}>
                <button
                  className={cx(ui.btn, ui.btnPrimary, styles.actionBtn, styles.addBtn)}
                  type="button"
                  aria-label={`Adicionar ${exercise.name} ${target === 'session' ? 'ao treino em andamento' : 'à rotina'}`}
                  onClick={() => chooseExercise(exercise)}
                >
                  + Adicionar
                </button>
                <Link
                  href={progressPath(exercise.id, hereUrl)}
                  className={cx(ui.btn, ui.btnSecondary, styles.actionBtn)}
                  aria-label={`Evolução em ${exercise.name}`}
                >
                  Evolução
                </Link>
                <button
                  className={cx(ui.btn, ui.btnSecondary, styles.actionBtn)}
                  type="button"
                  aria-label={`Instruções de ${exercise.name}`}
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  onClick={() => toggleDetails(exercise.id)}
                >
                  Instruções
                </button>
              </div>

              {detailsOpen && (
                <div id={detailsId} className={styles.instructions}>
                  {exercise.imageUrls?.length > 0 && (
                    <div className={styles.detailImages}>
                      {exercise.imageUrls.slice(0, 2).map((url, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={url}
                          src={url}
                          alt={`Demonstração de ${exercise.name}, posição ${index + 1}`}
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                      ))}
                    </div>
                  )}
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
                </div>
              )}
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
            onClick={() => void goToPage(pagination.page - 1)}
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
            onClick={() => void goToPage(pagination.page + 1)}
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
        <div className={styles.draftBar} role="region" aria-label="Rotina em montagem">
          <span>
            {draft.editingId ? 'Editando rotina' : 'Nova rotina'}:{' '}
            <strong>
              {draft.exercises.length} {draft.exercises.length === 1 ? 'exercício' : 'exercícios'}
            </strong>
          </span>
          <Link href="/dashboard#workout-form" className={styles.draftBarLink}>
            Ver rotina e definir séries →
          </Link>
        </div>
      )}

      <footer className={styles.footer}>
        As imagens são carregadas da base original pela internet. Confira sua disponibilidade antes de cada treino.
      </footer>
    </div>
  );
}
