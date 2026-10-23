import { PartialType } from '@nestjs/swagger';

import { CreateWorkoutDto } from './create-workout.dto';

/**
 * Todos os campos opcionais, mas com as MESMAS validações do cadastro.
 * (Com `Partial<CreateWorkoutDto>` o ValidationPipe não valida nada, pois o tipo some em runtime.)
 */
export class UpdateWorkoutDto extends PartialType(CreateWorkoutDto) {}
