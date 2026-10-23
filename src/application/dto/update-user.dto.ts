import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({
    required: false,
    description: 'Senha atual. Obrigatória para trocar a senha.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}
