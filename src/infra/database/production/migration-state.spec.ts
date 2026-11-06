import { evaluateMigrationState } from './migration-state';
import { GuardError } from './target';

const KNOWN = ['M1', 'M2', 'M3'];
const SCHEMA = ['users', 'workouts', 'workout_sessions', 'session_sets'];

describe('estado das migrations', () => {
  it('banco vazio: todas pendentes', () => {
    expect(
      evaluateMigrationState({ tables: [], applied: null }, KNOWN),
    ).toEqual({
      kind: 'empty',
      pending: KNOWN,
    });
  });

  it('parcial e completo, em ordem', () => {
    const tables = ['migrations', ...SCHEMA];
    expect(evaluateMigrationState({ tables, applied: ['M1'] }, KNOWN)).toEqual({
      kind: 'partial',
      pending: ['M2', 'M3'],
    });
    expect(
      evaluateMigrationState(
        { tables: [...tables, 'exercises'], applied: KNOWN },
        KNOWN,
      ),
    ).toEqual({ kind: 'complete', pending: [] });
  });

  it('tabela de migrations criada mas vazia (migration desfeita): pode recomeçar', () => {
    expect(
      evaluateMigrationState({ tables: ['migrations'], applied: [] }, KNOWN),
    ).toEqual({ kind: 'empty', pending: KNOWN });
  });

  it.each([
    [
      'tabelas sem registro de migrations (criadas por synchronize)',
      { tables: SCHEMA, applied: null },
      /nenhum registro de migrations/,
    ],
    [
      'tabela estranha ao FitTrack',
      { tables: ['clientes'], applied: null },
      /não pertencem ao FitTrack/,
    ],
    [
      'migration desconhecida',
      { tables: ['migrations', ...SCHEMA], applied: ['M1', 'X9'] },
      /não conhece/,
    ],
    [
      'fora de ordem',
      { tables: ['migrations', ...SCHEMA], applied: ['M2'] },
      /fora de ordem/,
    ],
    [
      'registro sem as tabelas',
      { tables: ['migrations'], applied: ['M1'] },
      /faltam tabelas/,
    ],
    [
      'registro vazio com tabelas',
      { tables: ['migrations', 'users'], applied: [] },
      /registro de migrations vazio/,
    ],
  ])('aborta: %s', (_label, snapshot, message) => {
    expect(() => evaluateMigrationState(snapshot, KNOWN)).toThrow(GuardError);
    expect(() => evaluateMigrationState(snapshot, KNOWN)).toThrow(message);
  });
});
