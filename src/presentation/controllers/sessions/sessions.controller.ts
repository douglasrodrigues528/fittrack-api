import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  CreateSessionDto,
  PreviousSetsQueryDto,
} from '../../../application/dto/create-session.dto';
import { CalendarQueryDto } from '../../../application/dto/calendar-query.dto';
import { ListSessionsQueryDto } from '../../../application/dto/list-sessions-query.dto';
import {
  FinishSessionDto,
  StartSessionDto,
  UpdateProgressDto,
} from '../../../application/dto/session-progress.dto';
import { SessionsService } from '../../../application/services/sessions/sessions.service';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

type AuthUser = { userId: string; email: string };

@ApiTags('Sessions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /** Registra de uma vez uma sessão já finalizada (compatibilidade e treinos feitos sem conexão). */
  @Post()
  create(@Body() data: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.create(data, user.userId);
  }

  /** Histórico: somente sessões concluídas. */
  @Get()
  findAll(@Query() query: ListSessionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.findAll(user.userId, query.page, query.limit);
  }

  /** Dias treinados: sessões concluídas do usuário iniciadas em [from, to) (ISO). */
  @Get('calendar')
  calendar(@Query() query: CalendarQueryDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.findCalendar(query.from, query.to, user.userId);
  }

  /** Abre uma sessão em andamento (treino livre, ou a partir de um treino planejado). */
  @Post('start')
  start(@Body() data: StartSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.start(data, user.userId);
  }

  /** Sessão em andamento do usuário, para retomar: { session: ... | null }. */
  @Get('active')
  findActive(@CurrentUser() user: AuthUser) {
    return this.sessionsService.findActive(user.userId);
  }

  /**
   * Valores para iniciar o treino planejado: por exercício, as séries do último treino concluído
   * desta rotina (ou as planejadas, se ainda não houver histórico).
   */
  /** A mesma referência para todas as rotinas do usuário: { data: [{ workoutId, exercises, ... }] }. */
  @Get('last-performance')
  lastPerformanceForAll(@CurrentUser() user: AuthUser) {
    return this.sessionsService.findLastPerformanceForAll(user.userId);
  }

  @Get('last-performance/:workoutId')
  lastPerformance(
    @Param('workoutId', ParseUUIDPipe) workoutId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionsService.findLastPerformance(workoutId, user.userId);
  }

  /** Últimas séries feitas de cada exercício, para pré-preencher o treino. */
  @Post('previous')
  @HttpCode(200)
  previous(@Body() body: PreviousSetsQueryDto, @CurrentUser() user: AuthUser) {
    return this.sessionsService.findPrevious(body.exercises, user.userId);
  }

  @Put(':id/progress')
  saveProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProgressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionsService.saveProgress(id, body.progress, user.userId);
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FinishSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessionsService.finish(id, body, user.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sessionsService.cancel(id, user.userId);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sessionsService.findById(id, user.userId);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sessionsService.delete(id, user.userId);
  }
}
