import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AuditModule } from './common/audit/audit.module';
import { EmailModule } from './common/email/email.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { CsrfGuard } from './common/auth/csrf.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RateLimitGuard } from './common/auth/rate-limit.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { validateEnv } from './config/env';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LocationsModule } from './modules/locations/locations.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { CustomersModule } from './modules/customers/customers.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SalesModule } from './modules/sales/sales.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditQueryModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { SyncModule } from './modules/sync/sync.module';

function parseTtlSeconds(value: string | undefined): number {
  if (!value) return 900;
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 900;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86_400 : 1;
  return amount * multiplier;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: parseTtlSeconds(config.get<string>('JWT_ACCESS_TTL')),
        },
      }),
    }),
    CommonModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    EmailModule,
    AuthModule,
    HealthModule,
    LocationsModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    SuppliersModule,
    CustomersModule,
    PurchasesModule,
    SalesModule,
    RefundsModule,
    TransfersModule,
    UsersModule,
    SettingsModule,
    NotificationsModule,
    AuditQueryModule,
    ReportsModule,
    AssistantModule,
    SyncModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
