import { createHash } from 'node:crypto';

import { GuardError } from './target';

/**
 * Catálogo de produção: o arquivo local já validado (pasta `data/`, fora do Git).
 * Nada é baixado: o conteúdo precisa bater com a impressão digital registrada aqui.
 */
export const CATALOG_FILE =
  'data/exercises/exercises-ptbr-full-translation.json';
export const CATALOG_SHA256 =
  '23d10d108bb811eb4daacdce611a7b28428a3ef03e6af817b73eddca792c983a';
export const CATALOG_COUNT = 873;

export interface CatalogExpectation {
  sha256: string;
  count: number;
}

export const EXPECTED_CATALOG: CatalogExpectation = {
  sha256: CATALOG_SHA256,
  count: CATALOG_COUNT,
};

/** Um exercício como é gravado. `images` guarda os caminhos originais, sem alteração. */
export interface CatalogRow {
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
}

export interface LoadedCatalog {
  sha256: string;
  rows: CatalogRow[];
}

/** Limites das colunas da tabela `exercises`. */
const TEXT_LIMITS = {
  id: 150,
  name: 255,
  force: 80,
  level: 80,
  mechanic: 80,
  equipment: 120,
  category: 80,
} as const;

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function optionalText(
  value: unknown,
  field: keyof typeof TEXT_LIMITS,
  where: string,
  problems: string[],
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    problems.push(`${where}: ${field} não é texto`);
    return null;
  }
  if (value.length > TEXT_LIMITS[field]) {
    problems.push(
      `${where}: ${field} passa de ${TEXT_LIMITS[field]} caracteres`,
    );
  }
  return value;
}

function textList(
  value: unknown,
  field: string,
  where: string,
  problems: string[],
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    problems.push(`${where}: ${field} precisa ser uma lista de textos`);
    return [];
  }
  return value as string[];
}

/**
 * Valida o conteúdo do arquivo: impressão digital, quantidade exata, IDs únicos e campos
 * obrigatórios. Qualquer problema aborta antes de conectar ao banco.
 */
export function parseCatalog(
  content: Buffer,
  expected: CatalogExpectation = EXPECTED_CATALOG,
): LoadedCatalog {
  const digest = sha256(content);
  if (digest !== expected.sha256) {
    throw new GuardError(
      `O arquivo do catálogo mudou: SHA-256 ${digest}, esperado ${expected.sha256}. Importação interrompida.`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(content.toString('utf8'));
  } catch {
    throw new GuardError('O arquivo do catálogo não é um JSON válido.');
  }
  if (!Array.isArray(data)) {
    throw new GuardError('O catálogo precisa ser uma lista de exercícios.');
  }
  if (data.length !== expected.count) {
    throw new GuardError(
      `O catálogo tem ${data.length} exercícios; são esperados exatamente ${expected.count}.`,
    );
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  const rows: CatalogRow[] = data.map((item: unknown, index): CatalogRow => {
    const where = `item ${index + 1}`;
    const record = (item ?? {}) as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!id) problems.push(`${where}: id ausente`);
    else if (id.length > TEXT_LIMITS.id)
      problems.push(`${where}: id longo demais`);
    else if (seen.has(id)) problems.push(`${where}: id repetido (${id})`);
    seen.add(id);
    if (!name) problems.push(`${where}: nome ausente`);
    else if (name.length > TEXT_LIMITS.name)
      problems.push(`${where}: nome longo demais`);
    const images = textList(record.images, 'images', where, problems);
    if (images.length === 0) problems.push(`${where}: sem imagens`);
    return {
      id: record.id as string,
      name: record.name as string,
      force: optionalText(record.force, 'force', where, problems),
      level: optionalText(record.level, 'level', where, problems),
      mechanic: optionalText(record.mechanic, 'mechanic', where, problems),
      equipment: optionalText(record.equipment, 'equipment', where, problems),
      primaryMuscles: textList(
        record.primaryMuscles,
        'primaryMuscles',
        where,
        problems,
      ),
      secondaryMuscles: textList(
        record.secondaryMuscles,
        'secondaryMuscles',
        where,
        problems,
      ),
      instructions: textList(
        record.instructions,
        'instructions',
        where,
        problems,
      ),
      category: optionalText(record.category, 'category', where, problems),
      images,
    };
  });

  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('; ');
    const more =
      problems.length > 10 ? ` (e mais ${problems.length - 10})` : '';
    throw new GuardError(`Catálogo inválido: ${shown}${more}.`);
  }
  return { sha256: digest, rows };
}

/** Mesma estrutura da entidade `ExerciseEntity` e do script de desenvolvimento. */
export const CREATE_CATALOG_TABLE = `
  CREATE TABLE IF NOT EXISTS exercises (
    id varchar(150) PRIMARY KEY,
    name varchar(255) NOT NULL,
    force varchar(80),
    level varchar(80),
    mechanic varchar(80),
    equipment varchar(120),
    primary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb,
    secondary_muscles jsonb NOT NULL DEFAULT '[]'::jsonb,
    instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
    category varchar(80),
    images jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;

export const CATALOG_COLUMNS = [
  'id',
  'name',
  'force',
  'level',
  'mechanic',
  'equipment',
  'primary_muscles',
  'secondary_muscles',
  'instructions',
  'category',
  'images',
  'created_at',
  'updated_at',
];

const BATCH_SIZE = 100;
const VALUES_PER_ROW = 11;

/** INSERT ... ON CONFLICT em lotes: devolve [sql, parâmetros] de cada lote. */
export function upsertStatements(rows: CatalogRow[]): [string, unknown[]][] {
  const statements: [string, unknown[]][] = [];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const params: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const base = index * VALUES_PER_ROW;
      params.push(
        row.id,
        row.name,
        row.force,
        row.level,
        row.mechanic,
        row.equipment,
        JSON.stringify(row.primaryMuscles),
        JSON.stringify(row.secondaryMuscles),
        JSON.stringify(row.instructions),
        row.category,
        JSON.stringify(row.images),
      );
      const p = (n: number) => `$${base + n}`;
      return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}::jsonb, ${p(8)}::jsonb, ${p(9)}::jsonb, ${p(10)}, ${p(11)}::jsonb, now())`;
    });
    statements.push([
      `INSERT INTO exercises (id, name, force, level, mechanic, equipment,
         primary_muscles, secondary_muscles, instructions, category, images, updated_at)
       VALUES ${tuples.join(',\n')}
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         force = EXCLUDED.force,
         level = EXCLUDED.level,
         mechanic = EXCLUDED.mechanic,
         equipment = EXCLUDED.equipment,
         primary_muscles = EXCLUDED.primary_muscles,
         secondary_muscles = EXCLUDED.secondary_muscles,
         instructions = EXCLUDED.instructions,
         category = EXCLUDED.category,
         images = EXCLUDED.images,
         updated_at = now()`,
      params,
    ]);
  }
  return statements;
}
