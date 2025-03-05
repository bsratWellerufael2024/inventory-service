import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import Redis from 'ioredis'; // Correct way to import Redis

@Injectable()
export class InventoryService implements OnModuleInit {
  private redisClient: Redis; // Type the redisClient properly

  constructor(
    @InjectRepository(Inventory)
    private inventoryRepository: Repository<Inventory>,
  ) {
    // Initialize Redis client
    this.redisClient = new Redis({
      host: 'localhost', // Change if Redis is running on a different host
      port: 6379, // Default Redis port
    });

    // Add Redis connection error handling
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
}
