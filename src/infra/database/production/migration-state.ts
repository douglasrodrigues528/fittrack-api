import { GuardError } from './target';

/** Tabela onde o TypeORM registra as migrations aplicadas (padrão do projeto). */
export const MIGRATIONS_TABLE = 'migrations';

/** Tabelas que o esquema do FitTrack pode ter. Qualquer outra é estado desconhecido. */
export const SCHEMA_TABLES = [
  'users',
  'workouts',
  'workout_sessions',
  'session_sets',
] as const;
export const CATALOG_TABLE = 'exercises';
const KNOWN_TABLES = new Set<string>([
  MIGRATIONS_TABLE,
  ...SCHEMA_TABLES,
  CATALOG_TABLE,
]);

export interface DatabaseSnapshot {
  /** Tabelas do schema `public`. */
  tables: string[];
  /** Nomes registrados em `migrations`, em ordem; null se a tabela não existe. */
  applied: string[] | null;
}

export interface MigrationState {
  kind: 'empty' | 'partial' | 'complete';
  pending: string[];
}

/**
 * Compara o banco com as migrations conhecidas. Aceita só três situações: banco vazio,
 * migrations aplicadas em ordem (todas ou só as primeiras) ou tudo aplicado. O resto aborta.
 */
export function evaluateMigrationState(
  snapshot: DatabaseSnapshot,
  known: string[],
): MigrationState {
  const unknownTables = snapshot.tables.filter((t) => !KNOWN_TABLES.has(t));
  if (unknownTables.length > 0) {
    throw new GuardError(
      `Estado desconhecido: tabelas que não pertencem ao FitTrack (${unknownTables.join(', ')}).`,
    );
  }

  if (snapshot.applied === null) {
    if (snapshot.tables.length > 0) {
      throw new GuardError(
        `Estado desconhecido: há tabelas (${snapshot.tables.join(', ')}) mas nenhum registro de migrations. Este banco não foi criado por estes comandos.`,
      );
    }
    return { kind: 'empty', pending: [...known] };
  }

  const applied = snapshot.applied;
  const unknownMigrations = applied.filter((name) => !known.includes(name));
  if (unknownMigrations.length > 0) {
    throw new GuardError(
      `Estado desconhecido: migrations registradas que este código não conhece (${unknownMigrations.join(', ')}).`,
    );
  }
  const inOrder = applied.every((name, index) => known[index] === name);
  if (!inOrder) {
    throw new GuardError(
      `Estado inconsistente: migrations registradas fora de ordem ou com lacunas (${applied.join(', ')}).`,
    );
  }

  const pending = known.slice(applied.length);
  if (applied.length > 0) {
    // Com pelo menos a primeira aplicada, as tabelas do esquema precisam existir.
    const missing = SCHEMA_TABLES.filter((t) => !snapshot.tables.includes(t));
    if (missing.length > 0) {
      throw new GuardError(
        `Estado inconsistente: migrations registradas, mas faltam tabelas (${missing.join(', ')}).`,
      );
    }
  } else {
    const schemaTables = snapshot.tables.filter((t) => t !== MIGRATIONS_TABLE);
    if (schemaTables.length > 0) {
      throw new GuardError(
        `Estado desconhecido: registro de migrations vazio, mas há tabelas (${schemaTables.join(', ')}).`,
      );
    }
  }

  return {
    kind:
      pending.length === 0
        ? 'complete'
        : applied.length === 0
          ? 'empty'
          : 'partial',
    pending,
  };
}
