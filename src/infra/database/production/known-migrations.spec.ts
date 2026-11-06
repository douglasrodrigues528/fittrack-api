import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWN_MIGRATION_NAMES } from './known-migrations';

describe('migrations conhecidas pelos comandos de produção', () => {
  it('acompanham exatamente a pasta de migrations, na mesma ordem', () => {
    const files = readdirSync(join(__dirname, '..', 'migrations'))
      .filter((file) => file.endsWith('.ts'))
      .sort();
    const fromFiles = files.map((file) => {
      const [timestamp, name] = file.replace(/\.ts$/, '').split('-');
      return `${name}${timestamp}`;
    });
    expect(KNOWN_MIGRATION_NAMES).toEqual(fromFiles);
    expect(KNOWN_MIGRATION_NAMES).toEqual([
      'JourneyAndSessions1792670400000',
      'CascadeWorkoutsOnUserDelete1792756800000',
      'AddUserTokenVersion1792760400000',
    ]);
  });
});
