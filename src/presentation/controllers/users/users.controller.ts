import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CreateUserDto } from '../../../application/dto/create-user.dto';
import { UpdateUserDto } from '../../../application/dto/update-user.dto';
import { UsersService } from '../../../application/services/users/users.service';
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
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() data: CreateUserDto) {
    return this.usersService.create(data);
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
