import { JourneyAndSessions1792670400000 } from '../migrations/1792670400000-JourneyAndSessions';
import { CascadeWorkoutsOnUserDelete1792756800000 } from '../migrations/1792756800000-CascadeWorkoutsOnUserDelete';
import { AddUserTokenVersion1792760400000 } from '../migrations/1792760400000-AddUserTokenVersion';

/**
 * Migrations de produção, em ordem. Lista explícita (sem glob) para o comando saber
 * exatamente o que espera encontrar; um teste garante que ela acompanha a pasta.
 */
export const KNOWN_MIGRATIONS = [
  JourneyAndSessions1792670400000,
  CascadeWorkoutsOnUserDelete1792756800000,
  AddUserTokenVersion1792760400000,
];

export const KNOWN_MIGRATION_NAMES = KNOWN_MIGRATIONS.map(
  (migration) => new migration().name,
);
