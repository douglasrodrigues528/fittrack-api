/*
 * Baixa o JSON traduzido e sincroniza o catálogo com PostgreSQL.
 * Requer Node.js 18+ (fetch nativo) e a dependência `pg` já usada pela API.
 * Execute a partir da raiz do projeto: node scripts/sync-exercises.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const DATASET_URL =
  'https://raw.githubusercontent.com/gugeldev/exercicios-bd-ptbr/main/exercises/exercises-ptbr-full-translation.json';
const OUTPUT_FILE = path.resolve(
  process.cwd(),
  'data/exercises/exercises-ptbr-full-translation.json',
);

function loadDotEnv() {
  const envFile = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;

  for (const originalLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function downloadDataset() {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  console.log('Baixando dataset traduzido...');

  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Falha ao baixar o JSON: HTTP ${response.status}`);
  }

  const content = await response.text();
  const exercises = JSON.parse(content);
  if (!Array.isArray(exercises) || exercises.length === 0) {
    throw new Error('O JSON baixado não contém uma lista válida de exercícios.');
  }

  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(exercises, null, 2)}\n`, 'utf8');
  console.log(`JSON salvo em ${path.relative(process.cwd(), OUTPUT_FILE)} (${exercises.length} exercícios).`);
  return exercises;
}

function createClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Variáveis de banco ausentes no ambiente/.env: ${missing.join(', ')}`);
  }

  return new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
}

async function syncExercises(exercises) {
  const client = createClient();
  await client.connect();

  try {
    await client.query(`
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
      )
    `);

    const sql = `
      INSERT INTO exercises (
        id, name, force, level, mechanic, equipment,
        primary_muscles, secondary_muscles, instructions, category, images, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb, now()
      )
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
        updated_at = now()
    `;

    let imported = 0;
    for (const exercise of exercises) {
      if (!exercise || typeof exercise.id !== 'string' || typeof exercise.name !== 'string') {
        continue;
      }

      await client.query(sql, [
        exercise.id,
        exercise.name,
        normalizeString(exercise.force),
        normalizeString(exercise.level),
        normalizeString(exercise.mechanic),
        normalizeString(exercise.equipment),
        JSON.stringify(normalizeArray(exercise.primaryMuscles)),
        JSON.stringify(normalizeArray(exercise.secondaryMuscles)),
        JSON.stringify(normalizeArray(exercise.instructions)),
        normalizeString(exercise.category),
        JSON.stringify(normalizeArray(exercise.images)),
      ]);
      imported += 1;
    }

    console.log(`Sincronização concluída: ${imported} exercícios inseridos/atualizados.`);
    console.log('Os IDs existentes são atualizados; registros antigos não são removidos automaticamente.');
  } finally {
    await client.end();
  }
}

async function main() {
  loadDotEnv();
  const exercises = await downloadDataset();
  await syncExercises(exercises);
}

main().catch((error) => {
  console.error('Não foi possível sincronizar os exercícios:', error.message);
  process.exitCode = 1;
});
