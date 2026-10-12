import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { APP_NAME } from '@bouffe/core';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: [...config.corsOrigins], credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  if (config.apiDocs) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${APP_NAME} API`)
        .setDescription('Nutrition, programme hebdomadaire, liste de courses, stocks et suivi du poids.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  }

  await app.listen(config.port);
  Logger.log(`API prête sur http://localhost:${config.port}/api${config.apiDocs ? ' — documentation : /api/docs' : ''}`, 'Bootstrap');
  if (config.isProd && config.signupMode === 'open') {
    Logger.warn('Les inscriptions sont ouvertes à tous : ALLOW_SIGNUP=false les ferme, SIGNUP_CODE les réserve aux invités.', 'Bootstrap');
  }
}
await bootstrap();
