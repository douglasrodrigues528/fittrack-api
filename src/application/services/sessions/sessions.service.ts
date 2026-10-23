import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import {
  CreateSessionDto,
  PreviousExerciseRefDto,
  SessionExerciseDto,
} from '../../dto/create-session.dto';
import {
  FinishSessionDto,
  SessionProgressDto,
  StartSessionDto,
} from '../../dto/session-progress.dto';
import { SessionSetEntity } from '../../../infra/database/entities/session-set.entity';
import {
  WorkoutSessionEntity,
  type SessionProgress,
} from '../../../infra/database/entities/workout-session.entity';
import { WorkoutEntity } from '../../../infra/database/entities/workout.entity';
import { resolveLastPerformance } from './last-performance';
import { groupExercises, resolveOrigin, toSessionView } from './session-view';

export const SESSION_IN_PROGRESS = 'SESSION_IN_PROGRESS';
export const SESSION_CLOSED = 'SESSION_CLOSED';

/** Quantas execuções concluídas da rotina são consultadas para achar o último registro de cada exercício. */
const PERFORMANCE_LOOKBACK = 50;

/** Tolerância para relógios de celular adiantados. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Um início informado pelo cliente (sessão aberta sem conexão) não pode ser mais antigo que isso. */
const MAX_OFFLINE_START_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = (error as QueryFailedError & { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}

/** Copia só os campos conhecidos (o DTO já validou cada um). */
function toStoredProgress(progress: SessionProgressDto): SessionProgress {
  return {
    title: progress.title,
    notes: progress.notes,
    restSeconds: progress.restSeconds,
    exercises: progress.exercises.map((exercise) => ({
      uid: exercise.uid,
      ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
      name: exercise.name,
      sets: exercise.sets.map((set) => ({
        uid: set.uid,
        type: set.type,
        weight: set.weight,
        reps: set.reps,
        done: set.done,
      })),
      previous: (exercise.previous ?? []).map((set) => ({
        type: set.type,
        weight: set.weight,
        reps: set.reps,
      })),
    })),
  };
}

/** Visão de uma sessão em andamento, com o estado da tela para retomar o treino. */
function toActiveView(session: WorkoutSessionEntity) {
  return {
    id: session.id,
    status: session.status,
    origin: resolveOrigin(session),
    workoutId: session.workoutId,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    progress: session.progress,
  };
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(WorkoutSessionEntity)
    private readonly sessionsRepository: Repository<WorkoutSessionEntity>,

    @InjectRepository(SessionSetEntity)
    private readonly setsRepository: Repository<SessionSetEntity>,

    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepository: Repository<WorkoutEntity>,

    private readonly dataSource: DataSource,
  ) {}

  /** Converte exercícios realizados em linhas de `session_sets` (uma por série feita). */
  private buildSets(exercises: SessionExerciseDto[], repository: Repository<SessionSetEntity>) {
    const sets: SessionSetEntity[] = [];
    exercises.forEach((exercise, exerciseOrder) => {
      exercise.sets.forEach((set, setOrder) => {
        sets.push(
          repository.create({
            exerciseId: exercise.exerciseId ?? null,
            exerciseName: exercise.name,
            exerciseOrder,
            setOrder,
            type: set.type,
            weight: set.weight,
            reps: set.reps,
          }),
        );
      });
    });
    return sets;
  }

  private async findOwnedRoutine(workoutId: string, userId: string) {
    const routine = await this.workoutsRepository.findOne({
      where: { id: workoutId, userId },
    });
    if (!routine) throw new BadRequestException('Rotina não encontrada.');
    return routine;
  }

  /**
   * Registra uma sessão já finalizada de uma vez. Continua disponível para compatibilidade
   * e como alternativa quando o treino aconteceu inteiro sem conexão.
   */
  async create(data: CreateSessionDto, userId: string) {
    const startedAt = new Date(data.startedAt);
    const finishedAt = new Date(data.finishedAt);
    if (finishedAt.getTime() < startedAt.getTime()) {
      throw new BadRequestException('O fim do treino não pode ser anterior ao início.');
    }

    if (data.workoutId) await this.findOwnedRoutine(data.workoutId, userId);

    const session = this.sessionsRepository.create({
      userId,
      workoutId: data.workoutId ?? null,
      status: 'completed',
      origin: data.workoutId ? 'planned' : 'free',
      title: data.title,
      startedAt,
      finishedAt,
      durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      notes: data.notes ?? null,
      progress: null,
      sets: this.buildSets(data.exercises, this.setsRepository),
    });

    const saved = await this.sessionsRepository.save(session);
    return toSessionView(saved);
  }

  /**
   * Abre uma sessão em andamento. Iniciar a partir de um treino planejado NÃO cria nem altera
   * o modelo; iniciar um treino livre NÃO cria treino planejado. Há no máximo uma sessão em
   * andamento por usuário (índice único parcial no banco).
   */
  async start(data: StartSessionDto, userId: string) {
    const routine = data.workoutId ? await this.findOwnedRoutine(data.workoutId, userId) : null;

    const now = Date.now();
    let startedAt = new Date(now);
    if (data.startedAt) {
      const informed = new Date(data.startedAt).getTime();
      if (informed > now + CLOCK_SKEW_MS) {
        throw new BadRequestException('O início do treino não pode estar no futuro.');
      }
      if (now - informed <= MAX_OFFLINE_START_MS) startedAt = new Date(informed);
    }

    const existing = await this.sessionsRepository.findOne({
      where: { userId, status: 'in_progress' },
    });
    if (existing) this.throwInProgress(existing);

    const session = this.sessionsRepository.create({
      userId,
      workoutId: routine?.id ?? null,
      status: 'in_progress',
      origin: routine ? 'planned' : 'free',
      title: data.progress.title.trim() || routine?.title || 'Treino livre',
      startedAt,
      finishedAt: null,
      durationSeconds: null,
      notes: null,
      progress: toStoredProgress(data.progress),
    });

    try {
      return toActiveView(await this.sessionsRepository.save(session));
    } catch (error) {
      // Duas requisições simultâneas: o índice único deixou passar só uma.
      if (!isUniqueViolation(error)) throw error;
      const active = await this.sessionsRepository.findOne({
        where: { userId, status: 'in_progress' },
      });
      if (active) this.throwInProgress(active);
      throw error;
    }
  }

  private throwInProgress(active: WorkoutSessionEntity): never {
    throw new ConflictException({
      statusCode: 409,
      code: SESSION_IN_PROGRESS,
      message:
        'Você já tem um treino em andamento. Retome-o ou descarte-o antes de iniciar outro.',
      activeSession: toActiveView(active),
    });
  }

  /** Sessão em andamento do usuário (para retomar após recarregar ou em outro aparelho). */
  async findActive(userId: string) {
    const session = await this.sessionsRepository.findOne({
      where: { userId, status: 'in_progress' },
    });
    return { session: session ? toActiveView(session) : null };
  }

  /** Grava o estado atual da tela do treino. Só altera sessões em andamento do próprio usuário. */
  async saveProgress(id: string, progress: SessionProgressDto, userId: string) {
    const stored = toStoredProgress(progress);
    const title = progress.title.trim();

    const result = await this.sessionsRepository
      .createQueryBuilder()
      .update(WorkoutSessionEntity)
      .set({
        progress: stored,
        ...(title ? { title } : {}),
        notes: progress.notes.trim() || null,
      })
      .where('id = :id AND "userId" = :userId AND status = :status', {
        id,
        userId,
        status: 'in_progress',
      })
      .returning(['id', 'updatedAt'])
      .execute();

    if (!result.affected) await this.throwNotEditable(id, userId);

    const row = (result.raw as { id: string; updatedAt: Date }[])[0];
    return { id: row.id, updatedAt: row.updatedAt };
  }

  private async throwNotEditable(id: string, userId: string): Promise<never> {
    const session = await this.sessionsRepository.findOne({ where: { id, userId } });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    throw new ConflictException({
      statusCode: 409,
      code: SESSION_CLOSED,
      message:
        session.status === 'completed'
          ? 'Este treino já foi finalizado.'
          : 'Este treino foi descartado.',
      status: session.status,
    });
  }

  /**
   * Conclui a sessão: grava as séries realizadas e a move para o histórico.
   * É idempotente: repetir a chamada (ex.: a resposta se perdeu na rede) devolve a mesma sessão
   * sem duplicar séries.
   */
  async finish(id: string, data: FinishSessionDto, userId: string) {
    const finished = await this.dataSource.transaction(async (manager: EntityManager) => {
      const sessions = manager.getRepository(WorkoutSessionEntity);
      const session = await sessions
        .createQueryBuilder('session')
        .where('session.id = :id AND session.userId = :userId', { id, userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!session) throw new NotFoundException('Sessão não encontrada');
      if (session.status === 'completed') return session.id;
      if (session.status === 'cancelled') {
        throw new ConflictException({
          statusCode: 409,
          code: SESSION_CLOSED,
          message: 'Este treino foi descartado e não pode ser finalizado.',
          status: session.status,
        });
      }

      const started = session.startedAt.getTime();
      const now = Date.now();
      let finishedAt = data.finishedAt ? new Date(data.finishedAt).getTime() : now;
      if (finishedAt > now + CLOCK_SKEW_MS) finishedAt = now;
      if (finishedAt < started) finishedAt = started;

      const setsRepository = manager.getRepository(SessionSetEntity);
      const sets = this.buildSets(data.exercises, setsRepository).map((set) => {
        set.sessionId = session.id;
        return set;
      });
      await setsRepository.save(sets);

      session.status = 'completed';
      session.title = data.title;
      session.notes = data.notes?.trim() || null;
      session.finishedAt = new Date(finishedAt);
      session.durationSeconds = Math.round((finishedAt - started) / 1000);
      session.progress = null;
      await sessions.save(session);
      return session.id;
    });

    return this.findById(finished, userId);
  }

  /** Descarta a sessão em andamento. As séries não vão para o histórico. */
  async cancel(id: string, userId: string) {
    const result = await this.sessionsRepository
      .createQueryBuilder()
      .update(WorkoutSessionEntity)
      .set({ status: 'cancelled', progress: null, finishedAt: () => 'now()' })
      .where('id = :id AND "userId" = :userId AND status = :status', {
        id,
        userId,
        status: 'in_progress',
      })
      .execute();

    if (!result.affected) {
      const session = await this.sessionsRepository.findOne({ where: { id, userId } });
      if (!session) throw new NotFoundException('Sessão não encontrada');
      if (session.status === 'completed') {
        throw new ConflictException({
          statusCode: 409,
          code: SESSION_CLOSED,
          message: 'Este treino já foi finalizado e está no histórico.',
          status: session.status,
        });
      }
    }
    return { message: 'Treino descartado' };
  }

  /** Histórico: somente sessões concluídas, da mais recente para a mais antiga. */
  async findAll(userId: string, page = 1, limit = 20) {
    const [sessions, total] = await this.sessionsRepository.findAndCount({
      where: { userId, status: 'completed' },
      relations: { sets: true },
      order: { finishedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: sessions.map((session) => toSessionView(session)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string, userId: string) {
    const session = await this.sessionsRepository.findOne({
      where: { id, userId },
      relations: { sets: true },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return toSessionView(session);
  }

  async delete(id: string, userId: string) {
    const session = await this.sessionsRepository.findOne({ where: { id, userId } });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    await this.sessionsRepository.remove(session);
    return { message: 'Sessão removida com sucesso' };
  }

  /**
   * Referência para iniciar o treino planejado de novo: para cada exercício da rotina, as séries
   * da execução CONCLUÍDA mais recente DESTA rotina (do próprio usuário) em que ele foi feito.
   * Sem histórico, devolve as séries planejadas. A rotina em si nunca é alterada.
   */
  async findLastPerformance(workoutId: string, userId: string) {
    const routine = await this.workoutsRepository.findOne({ where: { id: workoutId, userId } });
    if (!routine) throw new NotFoundException('Treino não encontrado');
    return this.performanceFor(routine, userId);
  }

  /** A mesma referência, para todas as rotinas do usuário (exibição no dashboard). */
  async findLastPerformanceForAll(userId: string) {
    const routines = await this.workoutsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const data = [];
    for (const routine of routines) data.push(await this.performanceFor(routine, userId));
    return { data };
  }

  private async performanceFor(routine: WorkoutEntity, userId: string) {
    const workoutId = routine.id;
    const sessions = await this.sessionsRepository.find({
      where: { userId, workoutId, status: 'completed' },
      relations: { sets: true },
      // Mais recente pela conclusão; em empate, pela criação do registro.
      order: { finishedAt: 'DESC', createdAt: 'DESC' },
      take: PERFORMANCE_LOOKBACK,
    });

    const exercises = resolveLastPerformance(
      routine.exercises ?? [],
      sessions.map((session) => ({
        id: session.id,
        finishedAt: session.finishedAt ?? session.startedAt,
        sets: session.sets ?? [],
      })),
    );

    return {
      workoutId: routine.id,
      title: routine.title,
      lastSession: sessions[0] ? { id: sessions[0].id, finishedAt: sessions[0].finishedAt } : null,
      exercises,
    };
  }

  /**
   * Para cada exercício pedido, devolve as séries da sessão concluída mais recente do usuário
   * em que ele apareceu (ou null). Casa por exerciseId do catálogo; sem id, pelo nome.
   */
  async findPrevious(refs: PreviousExerciseRefDto[], userId: string) {
    const results = [];
    for (const ref of refs) {
      const lookup = this.setsRepository
        .createQueryBuilder('s')
        .innerJoin('s.session', 'session')
        .where('session.userId = :userId', { userId })
        .andWhere('session.status = :status', { status: 'completed' });
      if (ref.exerciseId) lookup.andWhere('s.exerciseId = :exerciseId', { exerciseId: ref.exerciseId });
      else lookup.andWhere('s.exerciseName = :name', { name: ref.name });

      const latest = await lookup
        .select('s.sessionId', 'sessionId')
        .addSelect('session.finishedAt', 'finishedAt')
        .orderBy('session.finishedAt', 'DESC')
        .limit(1)
        .getRawOne<{ sessionId: string; finishedAt: Date }>();

      if (!latest) {
        results.push({ exerciseId: ref.exerciseId ?? null, name: ref.name, performedAt: null, sets: [] });
        continue;
      }

      const sets = await this.setsRepository.find({
        where: ref.exerciseId
          ? { sessionId: latest.sessionId, exerciseId: ref.exerciseId }
          : { sessionId: latest.sessionId, exerciseName: ref.name },
        order: { setOrder: 'ASC' },
      });
      const [exercise] = groupExercises(sets);
      results.push({
        exerciseId: ref.exerciseId ?? null,
        name: ref.name,
        performedAt: latest.finishedAt,
        sets: exercise?.sets ?? [],
      });
    }
    return results;
  }
}
