import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Inventory } from './entities/inventory.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { InventoryService } from './services/inventory.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { InventoryController } from './controllers/inventory.controller';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-ioredis';
import Redis from 'ioredis';
import { MailerModule, MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { NotificationService } from './services/notification.service';
import { StockMonitorService } from './services/stock-monitor.service';
import { StockMonitorController } from './controllers/stock-monitor.controller';
import { join } from 'path';
import { NotificationController } from './controllers/notification.controller';
import { ScheduleModule } from '@nestjs/schedule';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
      ScheduleModule.forRoot(),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        
        transport: {
          host: configService.get<string>('SMTP_HOST'),
          port: configService.get<number>('SMTP_PORT'),
          secure: JSON.parse(
            configService.get<string>('SMTP_SECURE') || 'false',
          ),
          auth: {
            user: configService.get<string>('SMTP_USER'),
            pass: configService.get<string>('SMTP_PASS'),
          },
          
        },
        defaults: {
          from: `"Inventory System" <${configService.get<string>('SMTP_FROM')}>`,
        },
        template: {
          dir: join(__dirname, '..', 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),

    ClientsModule.registerAsync([
      {
        name: 'REDIS_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.REDIS,
          options: {
            host: configService.get<string>('REDIS_HOST'),
            port: configService.get<number>('REDIS_PORT'),
            db: configService.get<number>('REDIS_DB', 0),
          },
        }),
      },
    ]),

    CacheModule.register({
      isGlobal: true,
      store: redisStore,
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      ttl: 30,
      db: Number(process.env.REDIS_DB) || 1,
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        
        type: configService.get<string>('DB_TYPE') as any,
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [Inventory, StockMovement],
        synchronize: configService.get<boolean>('DB_SYNC', true),
        logging: configService.get<boolean>('DB_LOGGING', false),
      }),
    }),

    TypeOrmModule.forFeature([Inventory, StockMovement]),
  ],
  controllers: [AppController, InventoryController, StockMonitorController,NotificationController],
  providers: [
    AppService,
    InventoryService,
    NotificationService,
    StockMonitorService,
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // console.log('SMTP Config:', {
        //   host: process.env.SMTP_HOST,
        //   port: process.env.SMTP_PORT,
        //   secure: process.env.SMTP_SECURE,
        //   user: process.env.SMTP_USER,
        //   pass: process.env.SMTP_PASS,
        //   from: process.env.SMTP_FROM,
        // });

        return new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          db: configService.get<number>('REDIS_DB', 1),
        });
      },
    },
  ],
})
export class AppModule {}
