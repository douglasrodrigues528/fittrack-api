import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../users/users.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy (A4: revogação de tokens)', () => {
  const getTokenVersion = jest.fn<Promise<number | null>, [string]>();
  const config = {
    get: (key: string) =>
      key === 'JWT_SECRET' ? 'segredo-de-teste' : undefined,
  };
  const strategy = new JwtStrategy(
    config as unknown as ConfigService,
    { getTokenVersion } as unknown as UsersService,
  );

  beforeEach(() => getTokenVersion.mockReset());

  it('aceita token da versão atual', async () => {
    getTokenVersion.mockResolvedValue(2);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@a.com', tv: 2 }),
    ).resolves.toEqual({
      userId: 'u1',
      email: 'a@a.com',
    });
  });

  it('recusa token emitido antes da troca de senha', async () => {
    getTokenVersion.mockResolvedValue(3);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@a.com', tv: 2 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token de conta excluída', async () => {
    getTokenVersion.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@a.com', tv: 0 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tokens antigos, sem versão, continuam válidos enquanto a senha não for trocada', async () => {
    getTokenVersion.mockResolvedValue(0);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@a.com' }),
    ).resolves.toMatchObject({ userId: 'u1' });
  });
});
