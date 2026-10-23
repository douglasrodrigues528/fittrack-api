import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WorkoutSessionEntity } from './workout-session.entity';

export const SET_TYPES = ['warmup', 'normal', 'drop', 'failure'] as const;
export type SetType = (typeof SET_TYPES)[number];

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : parseFloat(value)),
};

/** Uma série concluída. Só séries realizadas são gravadas. */
@Entity('session_sets')
export class SessionSetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  sessionId!: string;

  @ManyToOne(() => WorkoutSessionEntity, (session) => session.sets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session!: WorkoutSessionEntity;

  /** ID do catálogo, quando o exercício veio de lá. */
  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  exerciseId!: string | null;

  /** Nome no momento do treino (também identifica exercícios digitados à mão). */
  @Column({ type: 'varchar', length: 255 })
  exerciseName!: string;

  @Column({ type: 'int' })
  exerciseOrder!: number;

  @Column({ type: 'int' })
  setOrder!: number;

  @Column({ type: 'varchar', length: 16, default: 'normal' })
  type!: SetType;

  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    transformer: numericTransformer,
  })
  weight!: number;

  @Column({ type: 'int' })
  reps!: number;
}
