import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ListExercisesQueryDto } from '../../dto/list-exercises-query.dto';
import { ExerciseEntity } from '../../../infra/database/entities/exercise.entity';

const DEFAULT_IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

@Injectable()
export class ExercisesService {
  constructor(
    @InjectRepository(ExerciseEntity)
    private readonly exercisesRepository: Repository<ExerciseEntity>,
  ) {}

  async findAll(filters: ListExercisesQueryDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const query = this.exercisesRepository.createQueryBuilder('exercise');
    this.applyFilters(query, filters);

    const [items, total] = await query
      .orderBy('exercise.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: items.map((exercise) => this.withImageUrls(exercise)),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Valores existentes de músculo e equipamento, para os filtros do catálogo. */
  async findFilterOptions() {
    const [muscles, equipment] = await Promise.all([
      this.exercisesRepository.query(
        `SELECT DISTINCT muscle FROM exercises,
           jsonb_array_elements_text(primary_muscles || secondary_muscles) AS muscle
         ORDER BY muscle`,
      ) as Promise<{ muscle: string }[]>,
      this.exercisesRepository.query(
        `SELECT DISTINCT equipment FROM exercises WHERE equipment IS NOT NULL ORDER BY equipment`,
      ) as Promise<{ equipment: string }[]>,
    ]);
    return {
      muscles: muscles.map((row) => row.muscle),
      equipment: equipment.map((row) => row.equipment),
    };
  }

  async findById(id: string) {
    const exercise = await this.exercisesRepository.findOne({ where: { id } });

    if (!exercise) {
      throw new NotFoundException('Exercício não encontrado');
    }

    return this.withImageUrls(exercise);
  }

  private applyFilters(
    query: SelectQueryBuilder<ExerciseEntity>,
    filters: ListExercisesQueryDto,
  ) {
    if (filters.q) {
      query.andWhere(
        '(exercise.name ILIKE :search OR exercise.id ILIKE :search OR exercise.instructions::text ILIKE :search)',
        { search: `%${filters.q}%` },
      );
    }

    if (filters.muscle) {
      const muscle = JSON.stringify([filters.muscle]);
      query.andWhere(
        '(exercise.primaryMuscles @> CAST(:muscle AS jsonb) OR exercise.secondaryMuscles @> CAST(:muscle AS jsonb))',
        { muscle },
      );
    }

    if (filters.equipment) {
      query.andWhere('exercise.equipment = :equipment', {
        equipment: filters.equipment,
      });
    }

    if (filters.level) {
      query.andWhere('exercise.level = :level', { level: filters.level });
    }

    if (filters.category) {
      query.andWhere('exercise.category = :category', {
        category: filters.category,
      });
    }
  }

  private withImageUrls(exercise: ExerciseEntity) {
    const baseUrl = (
      process.env.EXERCISE_IMAGES_BASE_URL || DEFAULT_IMAGE_BASE_URL
    ).replace(/\/+$/, '');

    return {
      ...exercise,
      imageUrls: (exercise.images || []).map((imagePath) => {
        const safePath = imagePath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        return `${baseUrl}/${safePath}`;
      }),
    };
  }
}
