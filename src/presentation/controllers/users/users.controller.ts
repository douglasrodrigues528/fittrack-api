import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CreateUserDto } from '../../../application/dto/create-user.dto';
import { UpdateUserDto } from '../../../application/dto/update-user.dto';
import { UsersService } from '../../../application/services/users/users.service';
import {
  SignupLimitService,
  TooManySignupsException,
} from '../../../application/services/users/signup-limit.service';
import { clientIp } from '../../../shared/http/client-ip';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

type AuthUser = { userId: string; email: string };

/** Cada usuário só pode ver, alterar ou excluir a PRÓPRIA conta. */
function assertSelf(id: string, user: AuthUser) {
  if (id !== user.userId) {
    throw new ForbiddenException('Você só pode acessar a sua própria conta.');
  }
}

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly signupLimit: SignupLimitService,
    private readonly configService: ConfigService,
  ) {}

  /** Cadastro público: no máximo SIGNUP_LIMIT_PER_HOUR contas por IP por hora (429). */
  @Post()
  async create(
    @Body() data: CreateUserDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ip = clientIp(request, this.configService);
    try {
      this.signupLimit.assertAllowed(ip);
    } catch (error) {
      if (error instanceof TooManySignupsException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
    const user = await this.usersService.create(data);
    this.signupLimit.recordSignup(ip);
    return user;
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get('me')
  findMe(@CurrentUser() user: AuthUser) {
    return this.usersService.findById(user.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    assertSelf(id, user);
    return this.usersService.findById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSelf(id, user);
    return this.usersService.update(id, data);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    assertSelf(id, user);
    return this.usersService.delete(id);
  }
}
