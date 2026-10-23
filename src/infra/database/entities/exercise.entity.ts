import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('exercises')
export class ExerciseEntity {
  // Mantém o ID estável da base original, por exemplo: Bench_Press
  @PrimaryColumn({ type: 'varchar', length: 150 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  force!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  level!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  mechanic!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  equipment!: string | null;

  @Column({ name: 'primary_muscles', type: 'jsonb', default: () => "'[]'::jsonb" })
  primaryMuscles!: string[];

  @Column({ name: 'secondary_muscles', type: 'jsonb', default: () => "'[]'::jsonb" })
  secondaryMuscles!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  instructions!: string[];

  @Column({ type: 'varchar', length: 80, nullable: true })
  category!: string | null;

  // Caminhos relativos originais, por exemplo: Bench_Press/0.jpg
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  images!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
