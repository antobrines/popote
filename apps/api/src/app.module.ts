import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CatalogService } from './catalog/catalog.service.js';
import { LeclercProvider, ManualProvider, MockProvider, RetailProviderRegistry } from './catalog/providers.js';
import { JwtAuthGuard, Public } from './common/auth.js';
import { config } from './config.js';
import { DatabaseModule } from './db/schemas.js';
import { PlanningController } from './planning/planning.controller.js';
import { PlanningService } from './planning/planning.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { PushModule } from './push/push.module.js';
import { ShoppingController } from './shopping/shopping.controller.js';
import { ShoppingService } from './shopping/shopping.service.js';
import { StateService } from './state/state.service.js';
import { TrackingController } from './tracking/tracking.controller.js';

@ApiTags('système')
@Controller('health')
export class HealthController {
  /** Sonde de disponibilité (Docker, reverse proxy). */
  @Public()
  @Get()
  health() {
    return { status: 'ok', time: new Date().toISOString(), signup: config.allowSignup };
  }
}

@Module({
  imports: [
    MongooseModule.forRoot(config.mongo.uri, { dbName: config.mongo.dbName }),
    DatabaseModule,
    JwtModule.register({
      global: true,
      secret: config.auth.accessSecret,
      signOptions: { expiresIn: config.auth.accessTtlSeconds },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    PushModule,
  ],
  controllers: [HealthController, ProfileController, PlanningController, ShoppingController, TrackingController],
  providers: [
    CatalogService,
    ShoppingService,
    PlanningService,
    StateService,
    ManualProvider,
    LeclercProvider,
    MockProvider,
    RetailProviderRegistry,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
