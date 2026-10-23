import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ListExercisesQueryDto } from '../../../application/dto/list-exercises-query.dto';
import { ExercisesService } from '../../../application/services/exercises/exercises.service';

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista e filtra o catálogo de exercícios' })
  @ApiQuery({ name: 'q', required: false, description: 'Busca por nome, ID ou instruções' })
  @ApiQuery({ name: 'muscle', required: false, description: 'Músculo primário ou secundário, em português' })
  @ApiQuery({ name: 'equipment', required: false })
  @ApiQuery({ name: 'level', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query() filters: ListExercisesQueryDto) {
    return this.exercisesService.findAll(filters);
  }

  @Get('filters')
  @ApiOperation({ summary: 'Músculos e equipamentos disponíveis para filtrar' })
  findFilterOptions() {
    return this.exercisesService.findFilterOptions();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um exercício pelo ID original' })
  findById(@Param('id') id: string) {
    return this.exercisesService.findById(id);
  }
}
