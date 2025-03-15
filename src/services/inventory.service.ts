import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import Redis from 'ioredis';
import { StockMovement } from 'src/entities/stock-movement.entity';
import { DataSource } from 'typeorm';
import { RecordStockMovementDto } from 'src/dto/record-stock-movement.dto';
import { ClientProxy } from '@nestjs/microservices';

import { Logger } from '@nestjs/common';
@Injectable()
export class InventoryService implements OnModuleInit {
  private redisClient: Redis;
  private readonly logger = new Logger(InventoryService.name);
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
      console.log('Connected to Redis');
    });

    this.redisClient.on('error', (err) => {
      console.error(' Redis connection error:', err);
    });
  }

  async onModuleInit() {
    console.log('Subscribing to Redis events...');
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
      console.log(`Initializing stock for product ID: ${product.productId}`);

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
    const productIds = inventory.map((product) => product.productId);

    // Fetch stock movements (IN & OUT) grouped by productId
    const stockMovements = await this.stockMovementRepository
      .createQueryBuilder('stock_movement')
      .select('productId')
      .addSelect(`SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END)`, 'inQty')
      .addSelect(
        `SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END)`,
        'outQty',
      )
      .where('productId IN (:...productIds)', { productIds })
      .groupBy('productId')
      .getRawMany();
    const stockMovementMap = new Map<
      string,
      { inQty: number; outQty: number }
    >();
    stockMovements.forEach((movement) => {
      stockMovementMap.set(movement.productId, {
        inQty: parseInt(movement.inQty, 10) || 0,
        outQty: parseInt(movement.outQty, 10) || 0,
      });
    });

    const productDetails = await this.productClient
      .send('get_produts_details', { productIds })
      .toPromise();

    const filteredProducts = productDetails.filter((product) =>
      filter
        ? product.productName.toLowerCase().includes(filter.toLowerCase())
        : true,
    );

    type CategoryGroup = {
      category: string;
      subTotal: number;
      totalInQty: number;
      totalOutQty: number;
      products: {
        productName: string;
        unit: string;
        price: number;
        specification: string;
        quantityAvailable: number;
        inQty: number;
        outQty: number;
      }[];
    };

    const categoryGroups: Record<string, CategoryGroup> =
      filteredProducts.reduce(
        (acc, product) => {
          const inventoryItem = inventory.find(
            (inv) => inv.productId === product.productId,
          );
          const stockMovement = stockMovementMap.get(product.productId) || {
            inQty: 0,
            outQty: 0,
          };

          const category = product.category
            ? product.category.category
            : 'Uncategorized';
          const quantityAvailable = inventoryItem
            ? inventoryItem.quantityAvailable
            : 0;

          if (!acc[category]) {
            acc[category] = {
              category,
              subTotal: 0,
              totalInQty: 0,
              totalOutQty: 0,
              products: [],
            };
          }

          acc[category].subTotal += quantityAvailable;
          acc[category].totalInQty += stockMovement.inQty;
          acc[category].totalOutQty += stockMovement.outQty;

          acc[category].products.push({
            productName: product.productName,
            unit: product.baseUnit,
            price: product.selling_price,
            specification: product.specification,
            quantityAvailable,
            inQty: stockMovement.inQty,
            outQty: stockMovement.outQty,
          });

          return acc;
        },
        {} as Record<string, CategoryGroup>,
      );

    // Calculate overall totals
    const overallTotalQuantity = Object.values(categoryGroups).reduce(
      (sum, category) => sum + category.subTotal,
      0,
    );

    const overallTotalInQty = Object.values(categoryGroups).reduce(
      (sum, category) => sum + category.totalInQty,
      0,
    );

    const overallTotalOutQty = Object.values(categoryGroups).reduce(
      (sum, category) => sum + category.totalOutQty,
      0,
    );

    const groupedData = Object.values(categoryGroups);
    const offset = (page - 1) * limit;
    const paginatedCategories = groupedData.slice(offset, offset + limit);

    return {
      overallTotalQuantity,
      overallTotalInQty,
      overallTotalOutQty,
      categories: paginatedCategories,
    };
  }
}

