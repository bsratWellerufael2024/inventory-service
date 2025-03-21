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
import * as moment from 'moment';
import { createObjectCsvStringifier } from 'csv-writer';
import * as PDFDocument from 'pdfkit';
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
      // Extract data from message (handle both 'product.created' and 'product.updated' events)
      const { productId, openingQty } = message?.data || message;

      console.log(
        '[InventoryService] initializeStockLevel() called with:',
        message,
      );

      if (!productId) {
        console.error('[InventoryService] Product ID is missing');
        return;
      }

      if (openingQty === undefined) {
        console.warn(
          `[InventoryService] No openingQty provided for product ID ${productId}`,
        );
      }

      const existingInventory = await this.inventoryRepository.findOne({
        where: { productId },
      });

      if (existingInventory) {
        console.log(
          `[InventoryService] Found existing inventory for product ID ${productId}`,
        );
        if (openingQty !== undefined) {
          existingInventory.quantityAvailable = openingQty;
          await this.inventoryRepository.save(existingInventory);
          console.log(
            `[InventoryService] Updated stock level for product ID ${productId}`,
          );
        }
      } else {
        console.log(
          `[InventoryService] No existing inventory. Creating new inventory for product ID ${productId}`,
        );
        const newInventory = this.inventoryRepository.create({
          productId,
          quantityAvailable: openingQty || 0,
          lowStockThreshold: 5,
          lastRestocked: new Date(),
        });

        await this.inventoryRepository.save(newInventory);
        console.log(
          `[InventoryService] Stock initialized for product ID ${productId}`,
        );
      }
    } catch (error) {
      console.error('[InventoryService] Error initializing stock:', error);
    }
  }

  async recordStockMovement(
    dto: RecordStockMovementDto,
  ): Promise<StockMovement> {
    return this.dataSource.transaction(async (manager) => {
      const { productId, type, quantity, reason, activatedBy } = dto;

      if (!activatedBy) {
        throw new Error('ActivatedBy (username) is required');
      }

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
        activatedBy,
      });

      return await manager.save(stockMovement);
    });
  }

  async getStockMovements(filters: {
    productId?: number;
    activatedBy?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      productId,
      activatedBy,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = filters;

    const query =
      this.stockMovementRepository.createQueryBuilder('stockMovement');

    if (productId)
      query.andWhere('stockMovement.productId = :productId', { productId });
    if (activatedBy)
      query.andWhere('stockMovement.activatedBy = :activatedBy', {
        activatedBy,
      });
    if (startDate)
      query.andWhere('stockMovement.createdAt >= :startDate', { startDate });
    if (endDate)
      query.andWhere('stockMovement.createdAt <= :endDate', { endDate });

    query.orderBy('stockMovement.createdAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const now = moment();
    const formattedData = data.map((movement) => ({
      ...movement,
      timeAgo: moment(movement.createdAt).from(now),
    }));

    return { data: formattedData, total };
  }

  //generating the csv file
  async generateCsv(activatedBy?: string): Promise<string> {
    const whereCondition = activatedBy ? { activatedBy: activatedBy } : {}; // Ensure it's an object

    const movements = await this.stockMovementRepository.find({
      where: whereCondition, // Now TypeScript won't complain
      order: { createdAt: 'DESC' },
    });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'ID' },
        { id: 'productId', title: 'Product ID' },
        { id: 'quantity', title: 'Quantity' },
        { id: 'type', title: 'Type' },
        { id: 'activatedBy', title: 'Activated By' },
        { id: 'createdAt', title: 'Date' },
      ],
    });

    const records = movements.map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      quantity: movement.quantity,
      type: movement.type,
      activatedBy: movement.activatedBy,
      createdAt: movement.createdAt.toISOString(),
    }));

    return (
      csvStringifier.getHeaderString() +
      csvStringifier.stringifyRecords(records)
    );
  }

  //generating the pdf file

  async generatePdf(activatedBy?: string): Promise<Buffer> {
    const whereCondition = activatedBy ? { activatedBy: activatedBy } : {}; // Ensure correct type

    const movements = await this.stockMovementRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(16).text('Stock Movements Report', { align: 'center' });
      doc.moveDown();

      movements.forEach((movement) => {
        doc.fontSize(12).text(`Product ID: ${movement.productId}`);
        doc.text(`Quantity: ${movement.quantity}`);
        doc.text(`Type: ${movement.type}`);
        doc.text(`Activated By: ${movement.activatedBy}`);
        doc.text(`Date: ${movement.createdAt.toISOString()}`);
        doc.moveDown();
      });

      doc.end();
    });
  }

  async inventorySummary(filter?: string, page = 1, limit = 10) {
    const inventory = await this.inventoryRepository.find();
    const productIds = inventory.map((product) => product.productId);
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

