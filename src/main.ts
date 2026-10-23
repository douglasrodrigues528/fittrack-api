import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { getCorsOrigins, isProduction } from './shared/config/app-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Habilita o CORS apenas para os domínios do frontend (CORS_ORIGINS, separados por vírgula)
  app.enableCors({
    origin: getCorsOrigins(configService),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Validação global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Configuração do Swagger
  // Em produção a documentação fica desligada, a menos que ENABLE_SWAGGER=true.
  const swaggerEnabled =
    !isProduction(configService) ||
    configService.get<string>('ENABLE_SWAGGER') === 'true';

  const config = new DocumentBuilder()
    .setTitle('FitTrack API')
    .setDescription('API backend para gestão de usuários e treinos')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  // Hospedagens (Render etc.) informam a porta em PORT; escuta em 0.0.0.0.
  const port = Number(configService.get<string>('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 API rodando na porta ${port}`);
  if (swaggerEnabled) console.log(`📚 Swagger: http://localhost:${port}/docs`);
}

bootstrap();