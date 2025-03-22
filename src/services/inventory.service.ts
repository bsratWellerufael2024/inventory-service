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
    const whereCondition = activatedBy ? { activatedBy: activatedBy } : {};
    console.log('Where Condition:', whereCondition);

    const movements = await this.stockMovementRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    console.log('Fetched movements:', movements);

    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        console.log('PDF generation ended. Buffer size:', chunks.length);
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', (err) => {
        console.error('Error generating PDF:', err);
        reject(err);
      });

      doc.fontSize(16).text('Stock Movements Report', { align: 'center' });
      doc.moveDown();
      doc.text('This is a test line to ensure PDF rendering works.');

      movements.forEach((movement) => {
        console.log(`Adding movement: ${movement.productId}`);
        const productId = movement.productId || 'N/A';
        const quantity = movement.quantity || 0;
        const type = movement.type || 'N/A';
        const activatedBy = movement.activatedBy || 'Unknown';
        const date = movement.createdAt
          ? movement.createdAt.toISOString()
          : 'N/A';

        doc.fontSize(12).text(`Product ID: ${productId}`);
        doc.text(`Quantity: ${quantity}`);
        doc.text(`Type: ${type}`);
        doc.text(`Activated By: ${activatedBy}`);
        doc.text(`Date: ${date}`);
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

  async generateInventorySummaryPdf(summary): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => {});

    // Fonts
    const titleFontSize = 18;
    const headerFontSize = 10;
    const rowFontSize = 9;
    const rowHeight = 20;
    const tableLeft = 40;
    const tableWidth = 520;

    // Table columns
    const columns = [
      { label: 'Product', width: 90, align: 'left' },
      { label: 'Spec', width: 80, align: 'left' },
      { label: 'Unit', width: 50, align: 'left' },
      { label: 'InQty', width: 50, align: 'right' },
      { label: 'OutQty', width: 50, align: 'right' },
      { label: 'Available', width: 60, align: 'right' },
      { label: 'Price', width: 60, align: 'right' },
    ];

    // Title
    doc
      .fontSize(titleFontSize)
      .font('Helvetica-Bold')
      .text('Inventory Summary Report', { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Generated at: ${new Date().toLocaleString()}`);
    doc.moveDown();

    // Track current Y position
    let y = doc.y;

    for (const category of summary.categories) {
      // Category title
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(`Category: ${category.category}`, { underline: true });
      y = doc.y + 10;

      // Table header background
      doc.rect(tableLeft, y, tableWidth, rowHeight).fill('#f0f0f0');
      doc.fillColor('#000').fontSize(headerFontSize).font('Helvetica-Bold');

      // Table headers
      let x = tableLeft;
      for (const col of columns) {
        doc.text(col.label, x + 4, y + 6, {
          width: col.width,
          align: col.align,
        });
        x += col.width;
      }

      y += rowHeight;

      doc.fontSize(rowFontSize).font('Helvetica');

      let isAlternate = false;
      for (const product of category.products) {
        if (y + rowHeight > doc.page.height - 80) {
          doc.addPage();
          y = 40;
        }

        // Alternate row shading
        if (isAlternate) {
          doc.rect(tableLeft, y, tableWidth, rowHeight).fill('#fafafa');
        }
        doc.fillColor('#000'); // Reset text color

        // Table data
        x = tableLeft;
        const rowData = [
          product.productName,
          product.specification || '',
          product.unit,
          product.inQty.toString(),
          product.outQty.toString(),
          product.quantityAvailable.toString(),
          product.price.toFixed(2),
        ];

        for (let i = 0; i < columns.length; i++) {
          doc.text(rowData[i], x + 4, y + 6, {
            width: columns[i].width,
            align: columns[i].align,
          });
          x += columns[i].width;
        }

        y += rowHeight;
        isAlternate = !isAlternate;
      }

      doc.moveDown();
      y = doc.y;
    }

    // Add spacing before summary
    if (y + 60 > doc.page.height) doc.addPage();
    doc.moveDown(2);

    // Overall Summary
    doc.fontSize(12).font('Helvetica-Bold').text('Overall Summary');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Total InQty: ${summary.overallTotalInQty}`);
    doc.text(`Total OutQty: ${summary.overallTotalOutQty}`);
    doc.text(`Total Available: ${summary.overallTotalQuantity}`);

    // Optional: Page Footer with page number
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor('gray')
        .text(`Page ${i + 1} of ${pageCount}`, 40, doc.page.height - 30, {
          align: 'center',
          width: doc.page.width - 80,
        });
    }

    doc.end();
    await new Promise((resolve) => doc.on('end', resolve));
    return Buffer.concat(buffers);
  }

  async generateInventorySummaryCSV(summary): Promise<Buffer> {
    let csvContent = '';
    const divider =
      '============================================================\n';

    for (const category of summary.categories) {
      csvContent += `${divider}`;
      csvContent += `CATEGORY: ${category.category.toUpperCase()}\n`;
      csvContent += `${divider}`;

      const csvStringifier = createObjectCsvStringifier({
        header: [
          { id: 'productName', title: 'Product Name' },
          { id: 'specification', title: 'Specification' },
          { id: 'unit', title: 'Unit' },
          { id: 'inQty', title: 'In Qty' },
          { id: 'outQty', title: 'Out Qty' },
          { id: 'quantityAvailable', title: 'Available Qty' },
          { id: 'price', title: 'Price (USD)' },
        ],
      });

      const records = category.products.map((p) => ({
        productName: p.productName,
        specification: p.specification || '-',
        unit: p.unit,
        inQty: p.inQty,
        outQty: p.outQty,
        quantityAvailable: p.quantityAvailable,
        price: parseFloat(p.price.toFixed(2)),
      }));

      // Append headers and data
      csvContent += csvStringifier.getHeaderString();
      csvContent += csvStringifier.stringifyRecords(records);

      // Category-level subtotal
      const subtotal = records.reduce(
        (acc, curr) => {
          acc.inQty += curr.inQty;
          acc.outQty += curr.outQty;
          acc.available += curr.quantityAvailable;
          acc.totalPrice += curr.price * curr.quantityAvailable;
          return acc;
        },
        { inQty: 0, outQty: 0, available: 0, totalPrice: 0 },
      );

      csvContent += `Subtotal, , , ${subtotal.inQty}, ${subtotal.outQty}, ${subtotal.available}, ${subtotal.totalPrice.toFixed(2)}\n\n`;
    }

    // Overall Summary section
    csvContent += divider;
    csvContent += 'OVERALL SUMMARY\n';
    csvContent += divider;
    csvContent += `Total In Qty,${summary.overallTotalInQty}\n`;
    csvContent += `Total Out Qty,${summary.overallTotalOutQty}\n`;
    csvContent += `Total Available,${summary.overallTotalQuantity}\n`;

    return Buffer.from(csvContent, 'utf-8');
  }
}

