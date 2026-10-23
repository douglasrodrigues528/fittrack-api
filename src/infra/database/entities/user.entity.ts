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

  @CreateDateColumn()
  createdAt!: Date;
}