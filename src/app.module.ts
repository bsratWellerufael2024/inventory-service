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
import * as redisStore from 'cache-manager-ioredis'; // ✅ CORRECT import for this lib

@Module({
  imports: [
    // Redis Transport for microservices
    ClientsModule.register([
      {
        name: 'REDIS_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: 'localhost',
          port: 6379,
          db: 0,
        },
      },
    ]),

    // Redis Cache Module
    CacheModule.register({
      isGlobal: true,
      store: redisStore,
      host: 'localhost',
      port: 6379,
      ttl: 300,
    }),

    // Env and TypeORM
    ConfigModule.forRoot({
      isGlobal: true,
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
        synchronize: true,
        logging: false,
      }),
    }),

    TypeOrmModule.forFeature([Inventory, StockMovement]),
  ],
  controllers: [AppController, InventoryController],
  providers: [AppService, InventoryService],
})
export class AppModule {}
