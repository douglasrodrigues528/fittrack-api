import { GUARDS_METADATA } from '@nestjs/common/constants';

import { HEALTH_RESPONSE, HealthController } from './health.controller';

describe('HealthController', () => {
  it('responde que a API está ativa', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
    expect(HEALTH_RESPONSE).toEqual({ status: 'ok' });
  });

  it('não depende de nada injetado (nem banco) e não exige autenticação', () => {
    // Sem parâmetros no construtor: não há repositório, DataSource ou serviço por trás.
    expect(HealthController.length).toBe(0);
    expect(
      Reflect.getMetadata('design:paramtypes', HealthController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HealthController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        Object.getOwnPropertyDescriptor(HealthController.prototype, 'check')
          ?.value as object,
      ),
    ).toBeUndefined();
  });
});
