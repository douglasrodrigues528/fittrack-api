import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CATALOG_COUNT,
  CATALOG_FILE,
  CATALOG_SHA256,
  parseCatalog,
  sha256,
  upsertStatements,
} from './catalog';
import { GuardError } from './target';

function exercise(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Exercício ${id}`,
    force: 'empurrar',
    level: 'iniciante',
    mechanic: null,
    equipment: 'halteres',
    primaryMuscles: ['peito'],
    secondaryMuscles: [],
    instructions: ['Passo 1'],
    category: 'forca',
    images: [`${id}/0.jpg`, `${id}/1.jpg`],
    ...extra,
  };
}

/** Conteúdo + expectativa coerentes, para testar uma regra de cada vez. */
function fixture(items: unknown[], count = items.length) {
  const content = Buffer.from(JSON.stringify(items));
  return { content, expected: { sha256: sha256(content), count } };
}

describe('catálogo de produção', () => {
  it('aceita um arquivo íntegro e mantém os caminhos das imagens', () => {
    const { content, expected } = fixture([exercise('A'), exercise('B')]);
    const catalog = parseCatalog(content, expected);
    expect(catalog.rows).toHaveLength(2);
    expect(catalog.rows[0].images).toEqual(['A/0.jpg', 'A/1.jpg']);
    expect(catalog.rows[0].mechanic).toBeNull();
  });

  it('impressão digital diferente: interrompe', () => {
    const { content, expected } = fixture([exercise('A')]);
    expect(() =>
      parseCatalog(content, { ...expected, sha256: '0'.repeat(64) }),
    ).toThrow(/SHA-256/);
  });

  it('contagem incorreta: interrompe', () => {
    const { content, expected } = fixture([exercise('A'), exercise('B')], 873);
    expect(() => parseCatalog(content, expected)).toThrow(
      /tem 2 exercícios; são esperados exatamente 873/,
    );
  });

  it.each([
    ['id repetido', [exercise('A'), exercise('A')], /id repetido/],
    ['sem id', [exercise('')], /id ausente/],
    ['sem nome', [exercise('A', { name: ' ' })], /nome ausente/],
    ['sem imagens', [exercise('A', { images: [] })], /sem imagens/],
    [
      'lista inválida',
      [exercise('A', { instructions: 'texto' })],
      /instructions/,
    ],
    [
      'texto longo demais',
      [exercise('A', { equipment: 'x'.repeat(121) })],
      /equipment/,
    ],
  ])('inválido: %s', (_label, items, message) => {
    const { content, expected } = fixture(items);
    expect(() => parseCatalog(content, expected)).toThrow(GuardError);
    expect(() => parseCatalog(content, expected)).toThrow(message);
  });

  it('gera INSERTs em lotes com os mesmos dados (imagens incluídas)', () => {
    const rows = Array.from({ length: 250 }, (_, i) => exercise(`E${i}`)).map(
      (item) =>
        parseCatalog(fixture([item]).content, fixture([item]).expected).rows[0],
    );
    const statements = upsertStatements(rows);
    expect(statements).toHaveLength(3);
    expect(statements[0][1]).toHaveLength(100 * 11);
    expect(statements[2][1]).toHaveLength(50 * 11);
    expect(statements[0][1][10]).toBe(JSON.stringify(['E0/0.jpg', 'E0/1.jpg']));
    expect(statements[0][0]).toContain('ON CONFLICT (id) DO UPDATE');
  });

  const realFile = resolve(process.cwd(), CATALOG_FILE);
  (existsSync(realFile) ? it : it.skip)(
    'arquivo real validado (data/, fora do Git): 873 exercícios e impressão digital registrada',
    () => {
      const catalog = parseCatalog(readFileSync(realFile));
      expect(catalog.sha256).toBe(CATALOG_SHA256);
      expect(catalog.rows).toHaveLength(CATALOG_COUNT);
      expect(new Set(catalog.rows.map((row) => row.id)).size).toBe(873);
      // Imagens preservadas: todos os exercícios têm os caminhos originais.
      const images = catalog.rows.flatMap((row) => row.images);
      expect(images).toHaveLength(1746);
      expect(images.every((path) => /^[^/]+\/\d+\.jpg$/.test(path))).toBe(true);
    },
  );
});
