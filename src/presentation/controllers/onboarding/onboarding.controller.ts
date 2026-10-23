import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CompleteOnboardingDto } from '../../../application/dto/complete-onboarding.dto';
import { OnboardingService } from '../../../application/services/onboarding/onboarding.service';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';

type AuthUser = { userId: string; email: string };

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /** Estado da jornada: boas-vindas concluídas, vagas de treinos e sessão em andamento. */
  @Get()
  getState(@CurrentUser() user: AuthUser) {
    return this.onboardingService.getState(user.userId);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Body() body: CompleteOnboardingDto, @CurrentUser() user: AuthUser) {
    return this.onboardingService.complete(user.userId, body.choice);
  }
}
