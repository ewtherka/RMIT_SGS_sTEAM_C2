import 'reflect-metadata';
import { Module, Controller, Get, Inject, Res, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CONFIG, loadConfig, readAdapter, type AppConfig } from './config.js';
import { Database } from './database.js';
import { AuthGuard, Public } from './auth/auth.js';
import { Access, Identity } from './identity.js';
import { Scheduling } from './scheduling.js';
import { Notifications } from './notifications.js';
import { Bookings } from './bookings.js';
import { Medical } from './medical.js';
import { ErrorFilter, ApiError } from './errors.js';
import * as C from './controllers.js';
import { documentResponses } from './contract.js';

@Controller()
class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
  ) {}
  @Public() @Get('health/live') live() {
    return { status: 'ok', service: 'CareFlow', frontendIncluded: false };
  }
  @Public() @Get('health/ready') ready() {
    this.db.get('SELECT 1');
    const configured = Boolean(readAdapter(this.config.adapterPath));
    if (!configured)
      throw new ApiError(503, 'TIDE_NOT_CONFIGURED', 'SQLite sẵn sàng; đang chờ Tide enrolment và adapter.');
    return {
      status: 'ready',
      storage: 'sqlite',
      tideAdapter: 'configured',
      tideNetworkProof: 'NOT_VERIFIED',
      milvus: this.config.milvusAddress ? 'OPTIONAL_CONFIGURED' : 'DISABLED',
    };
  }
  @Public() @Get('v1/auth/config') authConfig() {
    const adapter = readAdapter(this.config.adapterPath);
    return {
      configured: Boolean(adapter),
      adapter: adapter ?? null,
      apiOrigin: this.config.publicUrl,
      allowedOrigins: this.config.origins,
      dpopRequired: true,
      callbackPath: '/auth/redirect',
      dpopRelayPath: '/tide_dpop_auth.html',
    };
  }
  @Public()
  @Get(['tide_dpop_auth.html', 'tide_dpop/*path'])
  relay(@Res() response: Response) {
    response.removeHeader('X-Frame-Options');
    response.setHeader('Allow-CSP-From', '*');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'");
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    response.sendFile(resolve('public/tide_dpop_auth.html'));
  }
}

@Module({})
class AppModule {
  static configure(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ...Object.values(C)],
      providers: [
        { provide: CONFIG, useValue: config },
        Database,
        Access,
        Identity,
        Scheduling,
        Notifications,
        Bookings,
        Medical,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}

export async function createApp(overrides: Partial<AppConfig> = {}) {
  const config = loadConfig(overrides);
  const app = await NestFactory.create(AppModule.configure(config), {
    bodyParser: false,
    logger: ['warn', 'error'],
  });
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: config.origins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'DPoP', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
  });
  app.use(json({ limit: '2mb', strict: true }));
  app.useGlobalFilters(new ErrorFilter());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CareFlow API')
      .setVersion('0.1.0')
      .setDescription(
        'Patient-centered booking and opaque Tide-encrypted record storage. All private routes require a fresh DPoP proof. Importing policy bytes is storage, not Tide approval.',
      )
      .addSecurity('DPoP', {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'DPoP <access_token>; also supply a fresh DPoP proof header for every request.',
      })
      .addServer(config.publicUrl)
      .build(),
  );
  // Public paths use explicit empty security. Preserve the matching runtime guard behavior.
  for (const [path, item] of Object.entries(doc.paths))
    if (
      path.startsWith('/health/') ||
      ['/v1/auth/config', '/v1/clinics', '/v1/services', '/v1/doctors', '/v1/availability'].includes(path) ||
      path === '/v1/doctors/{id}/availability'
    )
      for (const operation of Object.values(item!))
        if (operation && typeof operation === 'object') (operation as any).security = [];
  documentResponses(doc);
  SwaggerModule.setup('docs', app, doc, {
    jsonDocumentUrl: 'openapi.json',
    swaggerOptions: { persistAuthorization: false },
  });
  app.enableShutdownHooks();
  await app.init();
  return { app, config, doc };
}
