import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describeQuota, quotaFor, shouldShowWelcome, type JourneyState } from '../journey';

const fresh: JourneyState = {
  onboardingCompleted: false,
  choice: null,
  plannedWorkouts: quotaFor(0),
  completedSessions: 0,
  activeSession: null,
};

describe('journey', () => {
  it('calcula e descreve as vagas', () => {
    assert.deepEqual(quotaFor(3), { used: 3, limit: 7, remaining: 4 });
    assert.deepEqual(quotaFor(9), { used: 9, limit: 7, remaining: 0 });
    assert.equal(describeQuota(quotaFor(3)), 'Restam 4 vagas');
    assert.equal(describeQuota(quotaFor(6)), 'Resta 1 vaga');
    assert.equal(describeQuota(quotaFor(7)), 'Limite de 7 treinos atingido');
  });

  it('boas-vindas só para quem ainda não começou', () => {
    assert.equal(shouldShowWelcome(fresh, false, false), true);
    assert.equal(shouldShowWelcome(null, false, false), false, 'sem resposta da API não bloqueia o dashboard');
    assert.equal(shouldShowWelcome({ ...fresh, onboardingCompleted: true }, false, false), false);
    assert.equal(shouldShowWelcome(fresh, true, false), false);
    assert.equal(shouldShowWelcome(fresh, false, true), false, 'treino em andamento leva direto ao app');
  });
});
