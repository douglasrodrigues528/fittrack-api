import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WorkoutEntity } from './workout.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column({
    select: false,
  })
  password!: string;

  @OneToMany(() => WorkoutEntity, (workout) => workout.user)
  workouts!: WorkoutEntity[];

  /** Momento em que o usuário fez a primeira escolha da jornada inicial (rotina ou treino livre). */
  @Column({ type: 'timestamptz', nullable: true })
  onboardingCompletedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  onboardingChoice!: string | null;

  /**
   * Versão dos tokens de acesso. Vai no JWT e é conferida a cada requisição; incrementar
   * (ex.: ao trocar a senha) invalida todos os tokens emitidos antes. Não sai nas respostas.
   */
  @Column({ type: 'int', default: 0, select: false })
  tokenVersion!: number;

  @CreateDateColumn()
  createdAt!: Date;
}