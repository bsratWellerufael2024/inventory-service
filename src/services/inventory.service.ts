import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import Redis from 'ioredis'; // Correct way to import Redis
import { StockMovement } from 'src/entities/stock-movement.entity';
import { DataSource } from 'typeorm';
import { RecordStockMovementDto } from 'src/dto/record-stock-movement.dto';
import { ClientProxy } from '@nestjs/microservices';
@Injectable()
export class InventoryService implements OnModuleInit {
  private redisClient: Redis; // Type the redisClient properly

  constructor(
    @Inject('REDIS_SERVICE') private readonly productClient: ClientProxy,
    @InjectRepository(StockMovement)
    private stockMovementRepository: Repository<StockMovement>,

    @InjectRepository(Inventory)
    private inventoryRepository: Repository<Inventory>,

    private dataSource: DataSource, // Used for transactions
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

    // Subscribe to product.created channel
    this.redisClient.subscribe('product.created', (err, count) => {
      if (err) {
        console.error('❌ Redis subscription failed:', err);
      } else {
        console.log(`✅ Subscribed to ${count} channels.`);
      }
    });

    // Log when message is received on the subscribed channel
    this.redisClient.on('message', async (channel, message) => {
      if (channel === 'product.created') {
        console.log(`📬 Received message on channel ${channel}: ${message}`);
        try {
          const product = JSON.parse(message);
          console.log('📦 Parsed product:', product);
          await this.initializeStockLevel(product);
        } catch (err) {
          console.error('❌ Error parsing product message:', err);
        }
      }
    });
  }
  async initializeStockLevel(message: any) {
    try {
      // Ensure you're accessing the 'data' field
      //   const product = message.data;
      const product = message.data?.data; // Adjust this to match the structure of the message

      if (!product || !product.productId) {
        console.error('❌ Product ID is missing in the event message');
        return; // Exit if productId is missing
      }
      console.log(`💾 Initializing stock for product ID: ${product.productId}`);

      const newInventory = this.inventoryRepository.create({
        productId: product.productId, // Access productId correctly from 'data'
        quantityAvailable: product.openingQty || 0,
        lowStockThreshold: 5, // Default threshold
        lastRestocked: new Date(),
      });

      await this.inventoryRepository.save(newInventory);

      console.log(`✅ Stock initialized for product ID: ${product.productId}`);
    } catch (error) {
      console.error('❌ Error initializing stock:', error);
    }
  }

  async recordStockMovement(
    dto: RecordStockMovementDto,
  ): Promise<StockMovement> {
    return this.dataSource.transaction(async (manager) => {
      const {
        productId,
        variantId,
        type,
        quantity,
        reason,
        movementDate,
        activatedBy,
      } = dto;

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

      // 🔹 3. Update Inventory
      inventory.quantityAvailable = newQuantity;
      await manager.save(inventory);

      // 🔹 4. Record Stock Movement
      const stockMovement = this.stockMovementRepository.create({
        productId,
        variantId,
        type,
        quantity,
        reason,
        movementDate,
        activatedBy,
      });

      return await manager.save(stockMovement);
    });
  }

  async getInventorySummary() {
    const inventory = await this.inventoryRepository.find();

    const productIds = inventory.map((item) => item.productId);

    // 🔹 Request product details from Product Service
    const products = await this.productClient
      .send('get.products.by.ids', productIds)
      .toPromise();

    return inventory.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        productName: product?.name || 'Unknown',
        quantityAvailable: item.quantityAvailable,
        lowStockThreshold: item.lowStockThreshold,
        isLowStock: item.quantityAvailable <= item.lowStockThreshold,
      };
    });
  }
}
