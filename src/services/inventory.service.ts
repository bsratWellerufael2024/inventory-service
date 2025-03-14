import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import Redis from 'ioredis';
import { StockMovement } from 'src/entities/stock-movement.entity';
import { DataSource } from 'typeorm';
import { RecordStockMovementDto } from 'src/dto/record-stock-movement.dto';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class InventoryService implements OnModuleInit {
  private redisClient: Redis;

  constructor(
    @Inject('REDIS_SERVICE') private readonly productClient: ClientProxy,
    @InjectRepository(StockMovement)
    private stockMovementRepository: Repository<StockMovement>,

    @InjectRepository(Inventory)
    private inventoryRepository: Repository<Inventory>,

    private dataSource: DataSource,
  ) {
    this.redisClient = new Redis({
      host: 'localhost',
      port: 6379,
    });

    this.redisClient.on('connect', () => {
      console.log('✅ Connected to Redis');
    });

    this.redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err);
    });
  }

  async onModuleInit() {
    console.log('📡 Subscribing to Redis events...');
    this.redisClient.subscribe('product.created', (err, count) => {
      if (err) {
        console.error(' Redis subscription failed:', err);
      } else {
        console.log(`Subscribed to ${count} channels.`);
      }
    });

    this.redisClient.on('message', async (channel, message) => {
      if (channel === 'product.created') {
        console.log(` Received message on channel ${channel}: ${message}`);
        try {
          const product = JSON.parse(message);
          console.log('Parsed product:', product);
          await this.initializeStockLevel(product);
        } catch (err) {
          console.error('Error parsing product message:', err);
        }
      }
    });
  }
  async initializeStockLevel(message: any) {
    try {
      const product = message.data?.data;

      if (!product || !product.productId) {
        console.error('Product ID is missing in the event message');
        return;
      }
      console.log(`💾 Initializing stock for product ID: ${product.productId}`);

      const newInventory = this.inventoryRepository.create({
        productId: product.productId,
        quantityAvailable: product.openingQty || 0,
        lowStockThreshold: 5,
        lastRestocked: new Date(),
      });

      await this.inventoryRepository.save(newInventory);

      console.log(`Stock initialized for product ID: ${product.productId}`);
    } catch (error) {
      console.error('Error initializing stock:', error);
    }
  }

  async recordStockMovement(
    dto: RecordStockMovementDto,
  ): Promise<StockMovement> {
    return this.dataSource.transaction(async (manager) => {
      const { productId, type, quantity, reason } = dto;

      let inventory = await manager.findOne(Inventory, {
        where: { productId },
      });

      if (!inventory) {
        throw new Error(
          `Inventory record not found for productId: ${productId}`,
        );
      }
      let newQuantity = inventory.quantityAvailable;
      if (type === 'IN') {
        newQuantity += quantity;
      } else if (type === 'OUT') {
        if (quantity > inventory.quantityAvailable) {
          throw new Error(`Not enough stock for productId: ${productId}`);
        }
        newQuantity -= quantity;
      }

      inventory.quantityAvailable = newQuantity;
      await manager.save(inventory);
      const stockMovement = this.stockMovementRepository.create({
        productId,
        type,
        quantity,
        reason,
      });

      return await manager.save(stockMovement);
    });
  }

  async inventorySummary(filter?: string, page = 1, limit = 10) {
    const inventory = await this.inventoryRepository.find();
    const inventoryData = inventory.map((product) => ({
      productId: product.productId,
      quantityAvailable: product.quantityAvailable,
    }));

    const productIds = inventory.map((product) => product.productId);
    const productDetails = await this.productClient
      .send('get_produts_details', { productIds: productIds })
      .toPromise();
    const filteredProducts = productDetails.filter((product) =>
      filter
        ? product.productName.toLowerCase().includes(filter.toLowerCase())
        : true,
    );
    const offset = (page - 1) * limit;
    const paginatedProducts = filteredProducts.slice(offset, offset + limit);
    return paginatedProducts.map((product) => {
      const inventoryItem = inventoryData.find(
        (inv) => inv.productId === product.productId,
      );
      return {
        productName: product.productName,
        unit: product.baseUnit,
        category: product.category.category, 
        price: product.selling_price,
        specification: product.specification,
        quantityAvailable: inventoryItem ? inventoryItem.quantityAvailable : 0,
      };
    });
  }
}

