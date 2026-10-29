import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logging/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/live', 'health/ready'],
  });
  if ((config.get<number>('TRUST_PROXY') ?? 0) > 0) {
    app.set('trust proxy', config.get<number>('TRUST_PROXY'));
  } else {
    app.set('trust proxy', false);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: config.get('NODE_ENV') === 'production' ? undefined : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));

  const origins = (config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('KampalaSmart POS API')
    .setDescription(
      'Offline-first, multi-tenant point of sale and retail management API. All business endpoints require authentication and are isolated by tenant.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Short-lived access token' },
      'bearer',
    )
    .addCookieAuth('ks_at', { type: 'apiKey', in: 'cookie' }, 'cookie')
    .addServer('/api/v1', 'API v1')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });

  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT') ?? 4000;
  await app.listen(port, '0.0.0.0');
  logger.info(`KampalaSmart API listening on :${port}`, 'Bootstrap', {
    env: config.get('NODE_ENV'),
    docs: '/api/docs',
  });
}

bootstrap().catch((error) => {
  console.error('Fatal bootstrap error', error);
  process.exit(1);
});
