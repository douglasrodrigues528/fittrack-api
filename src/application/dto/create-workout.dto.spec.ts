import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateWorkoutDto } from './create-workout.dto';
import { UpdateWorkoutDto } from './update-workout.dto';

const options = { whitelist: true, forbidNonWhitelisted: true } as const;

async function errorsFor<T extends object>(cls: new () => T, plain: unknown) {
  return validate(plainToInstance(cls, plain) as object, options);
}

describe('CreateWorkoutDto', () => {
  const valid = {
    title: 'Peito',
    description: 'Força',
    exercises: [
      { exerciseId: 'Bench_Press', name: 'Supino reto', sets: [{ weight: 40, reps: 12 }] },
      { name: 'Exercício antigo, sem exerciseId', sets: [{ weight: 0, reps: 10 }] },
    ],
  };

  it('aceita vários exercícios, com e sem exerciseId (compatível com treinos existentes)', async () => {
    expect(await errorsFor(CreateWorkoutDto, valid)).toHaveLength(0);
  });

  it('rejeita exercício sem nenhuma série', async () => {
    const errors = await errorsFor(CreateWorkoutDto, {
      ...valid,
      exercises: [{ name: 'Supino', sets: [] }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita peso negativo e repetições zero/fracionadas', async () => {
    for (const set of [
      { weight: -1, reps: 10 },
      { weight: 10, reps: 0 },
      { weight: 10, reps: 2.5 },
    ]) {
      const errors = await errorsFor(CreateWorkoutDto, {
        ...valid,
        exercises: [{ name: 'X', sets: [set] }],
      });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejeita propriedades desconhecidas, como o uid usado só no frontend', async () => {
    const errors = await errorsFor(CreateWorkoutDto, {
      ...valid,
      exercises: [{ uid: 'abc', name: 'X', sets: [{ weight: 1, reps: 1 }] }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateWorkoutDto', () => {
  it('permite atualizar só o título', async () => {
    expect(await errorsFor(UpdateWorkoutDto, { title: 'Novo' })).toHaveLength(0);
  });

  it('aplica as mesmas validações e bloqueia campos como userId', async () => {
    expect(
      (await errorsFor(UpdateWorkoutDto, { exercises: [{ name: 'X', sets: [] }] })).length,
    ).toBeGreaterThan(0);
    expect((await errorsFor(UpdateWorkoutDto, { userId: 'outro-usuario' })).length).toBeGreaterThan(0);
  });
});
