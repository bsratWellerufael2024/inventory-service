import { Controller } from "@nestjs/common";
import { MessagePattern } from "@nestjs/microservices";
import { InventoryService } from "src/services/inventory.service";
import { Inject } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Payload } from "@nestjs/microservices";
import { Logger } from "@nestjs/common";
import { EventPattern } from "@nestjs/microservices";
import { InjectRepository, } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Inventory } from "src/entities/inventory.entity";
import { StockMovement } from "src/entities/stock-movement.entity";
// import { Cache } from '@nestjs/cache-manager';
import { Redis } from 'ioredis';  // Directly import Redis
@Controller()
export class InventoryController {
  private readonly logger = new Logger(InventoryService.name);
  constructor(
    @InjectRepository(Inventory)
    private inventoryRepository: Repository<Inventory>,
    private inventoryService: InventoryService,
    @Inject('REDIS_SERVICE') private readonly productClient: ClientProxy,

    @Inject('REDIS_CLIENT') // Inject Redis client directly
    private readonly redisClient: Redis,
  ) {}

  @MessagePattern('movement_recorded')
  recordStockMovement(dto: any) {
    return this.inventoryService.recordStockMovement(dto);
  }

  @MessagePattern('get_stock_movements')
  async getStockMovements(
    @Payload()
    filters: {
      productId?: number;
      activatedBy?: string;
      startDate?: string;
      endDate?: string;
      timeRange?: 'daily' | 'weekly' | 'monthly' | 'yearly';
      page?: number;
      limit?: number;
    },
  ): Promise<any> {
    return this.inventoryService.getStockMovements(filters);
  }

  @MessagePattern('export_csv')
  async handleCsvExport(@Payload() data: { activatedBy?: string }) {
    return this.inventoryService.generateCsv(data.activatedBy);
  }

  @EventPattern('generate-stock-movement-pdf')
  async handleGenerateStockMovementPdf(
    @Payload() payload: { activatedBy?: string },
  ) {
    const buffer = await this.inventoryService.generatePdf(payload.activatedBy);

    return {
      pdf: buffer.toString('base64'), // Encode buffer as base64 string
    };
  }

  @MessagePattern('export_inventory_summary_pdf')
  async handleSummaryPdfRequest() {
    const summary = await this.inventoryService.inventorySummary(); // fetch grouped summary
    const pdfBuffer =
      await this.inventoryService.generateInventorySummaryPdf(summary); // generate PDF
    return pdfBuffer; // this buffer will be received by the API Gateway
  }

  @MessagePattern('export_inventory_summary_csv')
  async handleSummaryCsvRequest() {
    const summary = await this.inventoryService.inventorySummary();
    const csvBuffer =
      await this.inventoryService.generateInventorySummaryCSV(summary);
    return csvBuffer; // ✅ No need to wrap it in `{ data: ... }`
  }

  // @MessagePattern('inventory.getSummary')
  // async getInventorySummary(
  //   @Payload() data: { filter?: string; page?: number; limit?: number },
  // ) {
  //   const { filter, page = 1, limit = 100 } = data;
  //   return await this.inventoryService.inventorySummary(filter, page, limit);
  // }

  @MessagePattern('inventory.getSummary')
  async getInventorySummary(
    @Payload() data: { filter?: string; page?: number; limit?: number },
  ) {
    const page = data.page && data.page > 0 ? data.page : 1;
    const limit = data.limit && data.limit > 0 ? data.limit : 100;
    const filter = data.filter?.trim() || undefined;

    // Call the service to get the inventory summary
    const summary = await this.inventoryService.inventorySummary(
      filter,
      page,
      limit,
    );

    return {
      success: true,
      message: 'Inventory summary with yearly report generated successfully',
      data: summary,
    };
  }

  @EventPattern('product.deleted')
  async handleProductDeleted(@Payload() data: { productId: number }) {
    this.logger.log(`Received product.deleted event: ${JSON.stringify(data)}`);

    const { productId } = data;

    if (!productId) {
      this.logger.error(`Missing productId in event payload`);
      return;
    }

    try {
      const inventoryRecord = await this.inventoryRepository.findOne({
        where: { productId },
      });

      if (inventoryRecord) {
        await this.inventoryRepository.remove(inventoryRecord);
        this.logger.log(
          `Successfully deleted inventory record for Product ID: ${productId}`,
        );
      } else {
        this.logger.warn(
          `No inventory record found for Product ID: ${productId}`,
        );
      }

      // Directly clear the Redis cache based on filter, page, and limit
      // Adjust these values accordingly if you want to clear specific cache keys
      const filters = ['all', 'category1', 'category2']; // Example filter values
      const pages = [1, 2, 3]; // Example page values
      const limits = [10, 20, 30]; // Example limit values

      // Loop through filter, page, and limit values and delete the corresponding cache keys
      for (const filter of filters) {
        for (const page of pages) {
          for (const limit of limits) {
            const cacheKey = `inventory_summary:${filter}:${page}:${limit}`;
            await this.redisClient.del(cacheKey);
            this.logger.log(`Cleared cache key: ${cacheKey}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Error occurred while deleting inventory for Product ID: ${productId}`,
        error,
      );
    }
  }

  @EventPattern('product.updated')
  async handleProductUpdated(payload: {
    productId: number;
    productName: string;
    openingQty: number;
  }) {
    await this.inventoryService.clearInventorySummaryCache();

    console.log(
      `[InventoryController] Cache invalidated due to product update`,
    );
  }
}
  


