import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const ONBOARDING_CHOICES = ['routine', 'free'] as const;
export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[number];

export class CompleteOnboardingDto {
  @ApiProperty({ enum: ONBOARDING_CHOICES, example: 'free' })
  @IsIn(ONBOARDING_CHOICES)
  choice!: OnboardingChoice;
}
