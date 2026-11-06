import { sha256 } from './catalog';
import { runProdCommand, type DbSession, type RunnerDeps } from './runner';
import { GuardError } from './target';

const HOST = 'ep-x.us-east-1.aws.neon.tech';
const NEON = `postgresql://app_user:s3gr3d0@${HOST}/neondb?sslmode=require&channel_binding=require`;
const KNOWN = ['M1', 'M2', 'M3'];
const SCHEMA = ['users', 'workouts', 'workout_sessions', 'session_sets'];

interface FakeDb {
  database: string;
  ssl: boolean;
  tables: string[];
  applied: string[] | null;
  exercises: string[];
  /** Tudo o que tentou escrever (migrations, transações de escrita). */
  writes: string[];
  failImport?: boolean;
}

function fakeSession(db: FakeDb): DbSession {
  const read = (sql: string): unknown[] => {
    if (sql.includes('current_database()')) {
      return [
        {
          database: db.database,
          user: 'app_user',
          ssl: db.ssl,
          version: 'PostgreSQL 17.5, compiled',
        },
      ];
    }
    if (sql.includes('information_schema.tables')) {
      return db.tables.map((table_name) => ({ table_name }));
    }
    if (sql.includes('FROM "migrations"')) {
      return (db.applied ?? []).map((name) => ({ name }));
    }
    if (sql.includes('information_schema.columns')) {
      return [
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
      ].map((column_name) => ({ column_name }));
    }
    if (sql.startsWith('SELECT id FROM exercises')) {
      return db.exercises.map((id) => ({ id }));
    }
    if (sql.includes('count(*)')) return [{ count: db.exercises.length }];
    throw new Error(`consulta inesperada: ${sql}`);
  };
  return {
    inspect: (fn) =>
      fn((sql) => {
        if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql)) {
          throw new Error('escrita numa transação somente leitura');
        }
        return Promise.resolve(read(sql) as any[]);
      }),
    runMigrations: () => {
      db.writes.push('migrations');
      const done = KNOWN.slice(db.applied?.length ?? 0);
      db.applied = [...KNOWN];
      db.tables = Array.from(new Set([...db.tables, 'migrations', ...SCHEMA]));
      return Promise.resolve(done);
    },
    write: async (fn) => {
      db.writes.push('transação');
      const staged = [...db.exercises];
      const result = await fn((sql, params) => {
        if (sql.includes('CREATE TABLE IF NOT EXISTS exercises')) {
          if (!db.tables.includes('exercises')) db.tables.push('exercises');
          return Promise.resolve([]);
        }
        if (sql.includes('INSERT INTO exercises')) {
          const values = params ?? [];
          for (let i = 0; i < values.length; i += 11) {
            const id = values[i] as string;
            if (!staged.includes(id)) staged.push(id);
          }
          if (db.failImport) staged.push('extra-fantasma');
          return Promise.resolve([]);
        }
        if (sql.includes('count(*)'))
          return Promise.resolve([{ count: staged.length }]);
        throw new Error(`escrita inesperada: ${sql}`);
      });
      // Só confirma se a função terminou sem erro (como COMMIT/ROLLBACK).
      db.exercises = staged;
      return result;
    },
    close: () => Promise.resolve(),
  };
}

function catalogFile(count: number) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `E${i}`,
    name: `Exercício ${i}`,
    force: null,
    level: 'iniciante',
    mechanic: null,
    equipment: null,
    primaryMuscles: ['peito'],
    secondaryMuscles: [],
    instructions: ['Passo'],
    category: 'forca',
    images: [`E${i}/0.jpg`],
  }));
  return Buffer.from(JSON.stringify(items));
}

function setup(overrides: Partial<RunnerDeps> = {}, db: Partial<FakeDb> = {}) {
  const state: FakeDb = {
    database: 'neondb',
    ssl: true,
    tables: [],
    applied: null,
    exercises: [],
    writes: [],
    ...db,
  };
  const file = catalogFile(5);
  const lines: string[] = [];
  const prompts: string[] = [];
  const connect = jest.fn(() => Promise.resolve(fakeSession(state)));
  const deps: RunnerDeps = {
    argv: ['migrate'],
    env: { DATABASE_URL: NEON, CONFIRM_DB_HOST: HOST },
    devIdentity: { host: 'localhost', database: 'fittrack_exercises_test' },
    knownMigrations: KNOWN,
    readFile: () => file,
    connect,
    prompt: (question) => {
      prompts.push(question);
      return Promise.resolve('APLICAR');
    },
    log: (line) => lines.push(line),
    catalogExpectation: { sha256: sha256(file), count: 5 },
    ...overrides,
  };
  return { deps, state, lines, prompts, connect };
}

describe('db:prod:* (guarda dos comandos de produção)', () => {
  it('sem DATABASE_URL: recusa sem conectar (o .env nunca é usado)', async () => {
    const { deps, connect } = setup({ env: { CONFIRM_DB_HOST: HOST } });
    await expect(runProdCommand(deps)).rejects.toThrow(
      /DATABASE_URL não está definida/,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('host local sem autorização de ensaio: recusa sem conectar', async () => {
    const { deps, connect } = setup({
      env: {
        DATABASE_URL: 'postgres://u:p@localhost/fittrack_deploy_test',
        CONFIRM_DB_HOST: 'localhost',
      },
    });
    await expect(runProdCommand(deps)).rejects.toThrow(/Host local/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('banco de desenvolvimento do .env: recusa mesmo no ensaio', async () => {
    const { deps, connect } = setup({
      argv: ['migrate', '--allow-local-test'],
      env: {
        DATABASE_URL: 'postgres://u:p@localhost/fittrack_exercises_test',
        CONFIRM_DB_HOST: 'localhost',
      },
    });
    await expect(runProdCommand(deps)).rejects.toThrow(
      /banco de desenvolvimento/,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('CONFIRM_DB_HOST divergente ou ausente: recusa sem conectar', async () => {
    const wrong = setup({
      env: { DATABASE_URL: NEON, CONFIRM_DB_HOST: 'ep-outro.neon.tech' },
    });
    await expect(runProdCommand(wrong.deps)).rejects.toThrow(/não confere/);
    const missing = setup({ env: { DATABASE_URL: NEON } });
    await expect(runProdCommand(missing.deps)).rejects.toThrow(
      /CONFIRM_DB_HOST/,
    );
    expect(wrong.connect).not.toHaveBeenCalled();
    expect(missing.connect).not.toHaveBeenCalled();
  });

  it('remoto sem SSL: recusa', async () => {
    const { deps, connect } = setup({
      env: {
        DATABASE_URL: `postgres://u:p@${HOST}/neondb`,
        CONFIRM_DB_HOST: HOST,
      },
    });
    await expect(runProdCommand(deps)).rejects.toThrow(/SSL é obrigatório/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('conexão que não usa SSL de fato: aborta antes de qualquer escrita', async () => {
    const { deps, state } = setup(
      { argv: ['migrate', '--apply'] },
      { ssl: false },
    );
    await expect(runProdCommand(deps)).rejects.toThrow(/não está usando SSL/);
    expect(state.writes).toEqual([]);
  });

  it('dry-run é o padrão: mostra o destino sem a senha e não grava nada', async () => {
    const { deps, state, lines, prompts } = setup();
    await runProdCommand(deps);
    expect(state.writes).toEqual([]);
    expect(prompts).toEqual([]);
    const output = lines.join('\n');
    expect(output).toContain(`host=${HOST}`);
    expect(output).toContain('banco=neondb');
    expect(output).toContain('usuário=app_user');
    expect(output).not.toContain('s3gr3d0');
    expect(output).toContain('SIMULAÇÃO');
    expect(output).toContain('Migrations pendentes: M1, M2, M3');
    expect(output).toContain('nenhuma alteração');
  });

  it('--apply sem a palavra de confirmação: não grava', async () => {
    const { deps, state } = setup({
      argv: ['migrate', '--apply'],
      prompt: () => Promise.resolve('sim'),
    });
    await expect(runProdCommand(deps)).rejects.toThrow(
      /Confirmação não recebida/,
    );
    expect(state.writes).toEqual([]);
  });

  it('--apply confirmado: aplica as 3 migrations e confere o resultado', async () => {
    const { deps, state, lines, prompts } = setup({
      argv: ['migrate', '--apply'],
    });
    await runProdCommand(deps);
    expect(prompts[0]).toContain(`${HOST}/neondb`);
    expect(state.writes).toEqual(['migrations']);
    expect(state.applied).toEqual(KNOWN);
    expect(lines.join('\n')).toContain('Migrations aplicadas: M1, M2, M3.');
  });

  it('estado inesperado das migrations: aborta sem gravar', async () => {
    const { deps, state } = setup(
      { argv: ['migrate', '--apply'] },
      { tables: SCHEMA, applied: null },
    );
    await expect(runProdCommand(deps)).rejects.toThrow(/Estado desconhecido/);
    expect(state.writes).toEqual([]);
  });

  it('--dry-run e --apply juntos, ou opção desconhecida: recusa', async () => {
    await expect(
      runProdCommand(setup({ argv: ['migrate', '--apply', '--dry-run'] }).deps),
    ).rejects.toThrow(GuardError);
    await expect(
      runProdCommand(setup({ argv: ['migrate', '--force'] }).deps),
    ).rejects.toThrow(/Opção desconhecida/);
  });

  describe('catálogo', () => {
    const migrated = { tables: ['migrations', ...SCHEMA], applied: KNOWN };

    it('contagem incorreta no arquivo: interrompe antes de conectar', async () => {
      const file = catalogFile(4);
      const { deps, connect } = setup(
        {
          argv: ['catalog', '--apply'],
          readFile: () => file,
          catalogExpectation: { sha256: sha256(file), count: 5 },
        },
        migrated,
      );
      await expect(runProdCommand(deps)).rejects.toThrow(
        /esperados exatamente 5/,
      );
      expect(connect).not.toHaveBeenCalled();
    });

    it('arquivo ausente: interrompe', async () => {
      const { deps } = setup(
        {
          argv: ['catalog'],
          readFile: () => {
            throw new Error('ENOENT');
          },
        },
        migrated,
      );
      await expect(runProdCommand(deps)).rejects.toThrow(/não encontrado/);
    });

    it('antes das migrations: recusa', async () => {
      const { deps, state } = setup({ argv: ['catalog', '--apply'] });
      await expect(runProdCommand(deps)).rejects.toThrow(
        /rode db:prod:migrate/,
      );
      expect(state.writes).toEqual([]);
    });

    it('dry-run: mostra o plano e não grava', async () => {
      const { deps, state, lines } = setup({ argv: ['catalog'] }, migrated);
      await runProdCommand(deps);
      expect(state.writes).toEqual([]);
      expect(lines.join('\n')).toContain('5 a inserir, 0 a atualizar');
    });

    it('--apply: importa tudo numa transação e confere a contagem final', async () => {
      const { deps, state, lines } = setup(
        { argv: ['catalog', '--apply'] },
        migrated,
      );
      await runProdCommand(deps);
      expect(state.writes).toEqual(['transação']);
      expect(state.exercises).toHaveLength(5);
      expect(lines.join('\n')).toContain('Catálogo importado: 5 exercícios.');
    });

    it('contagem final errada dentro da transação: desfaz tudo', async () => {
      const { deps, state } = setup(
        { argv: ['catalog', '--apply'] },
        { ...migrated, failImport: true },
      );
      await expect(runProdCommand(deps)).rejects.toThrow(/Nada foi gravado/);
      expect(state.exercises).toEqual([]);
    });

    it('exercícios no banco fora do arquivo validado: aborta', async () => {
      const { deps, state } = setup(
        { argv: ['catalog', '--apply'] },
        {
          tables: [...migrated.tables, 'exercises'],
          applied: KNOWN,
          exercises: ['E0', 'Fantasma'],
        },
      );
      await expect(runProdCommand(deps)).rejects.toThrow(
        /fora do arquivo validado/,
      );
      expect(state.writes).toEqual([]);
    });
  });
});
