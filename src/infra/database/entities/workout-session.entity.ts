import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SessionSetEntity } from './session-set.entity';
import { UserEntity } from './user.entity';
import { WorkoutEntity } from './workout.entity';

export const SESSION_STATUSES = [
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_ORIGINS = ['planned', 'free'] as const;
export type SessionOrigin = (typeof SESSION_ORIGINS)[number];

/** Estado de edição de uma sessão em andamento (o que está na tela do treino). */
export interface SessionProgress {
  title: string;
  notes: string;
  restSeconds: number;
  exercises: {
    uid: string;
    exerciseId?: string;
    name: string;
    sets: {
      uid: string;
      type: string;
      weight: string;
      reps: string;
      done: boolean;
    }[];
    previous?: { type: string; weight: number; reps: number }[];
  }[];
}

/** Uma sessão de treino REALMENTE executada (diferente da rotina/plano em `workouts`). */
@Entity('workout_sessions')
// No máximo uma sessão em andamento por usuário (garantido pelo banco, mesmo com requisições simultâneas).
@Index('UQ_workout_sessions_user_in_progress', ['userId'], {
  unique: true,
  where: `"status" = 'in_progress'`,
})
export class WorkoutSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** Rotina de origem. Fica nulo se a rotina for excluída depois (o histórico permanece). */
  @Column({ type: 'uuid', nullable: true })
  workoutId!: string | null;

  @ManyToOne(() => WorkoutEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'workoutId' })
  workout!: WorkoutEntity | null;

  /** Registros antigos (anteriores a esta coluna) ficam com status `completed`. */
  @Column({ type: 'varchar', length: 16, default: 'completed' })
  status!: SessionStatus;

  /** Treino planejado ou livre. Nulo em registros antigos: deduzido a partir de `workoutId`. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  origin!: SessionOrigin | null;

  /** Cópia do título da rotina no momento do treino. */
  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  /** Nulo enquanto a sessão está em andamento. */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds!: number | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Rascunho da sessão em andamento; limpo ao concluir ou cancelar (as séries feitas vão para `session_sets`). */
  @Column({ type: 'jsonb', nullable: true })
  progress!: SessionProgress | null;

  @OneToMany(() => SessionSetEntity, (set) => set.session, {
    cascade: ['insert'],
  })
  sets!: SessionSetEntity[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
