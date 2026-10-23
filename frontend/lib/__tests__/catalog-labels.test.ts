import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { catalogLabel, sortByLabel } from '../catalog-labels';

describe('catalogLabel', () => {
  it('traduz slugs conhecidos com acentos', () => {
    assert.equal(catalogLabel('peso-do-corpo'), 'Peso do corpo');
    assert.equal(catalogLabel('quadriceps'), 'Quadríceps');
  });

  it('valores novos ainda ficam legíveis', () => {
    assert.equal(catalogLabel('elastico-longo'), 'Elastico longo');
  });

  it('ordena pelo rótulo em português', () => {
    assert.deepEqual(sortByLabel(['triceps', 'biceps', 'abdominais']), ['abdominais', 'biceps', 'triceps']);
  });
});
