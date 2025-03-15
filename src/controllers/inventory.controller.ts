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
@Controller()
export class InventoryController {
  private readonly logger = new Logger(InventoryService.name);
  constructor(
     @InjectRepository(Inventory)
        private inventoryRepository: Repository<Inventory>,
    private inventoryService: InventoryService,
    @Inject('REDIS_SERVICE') private readonly productClient: ClientProxy,
  ) {}
  @MessagePattern('movement_recorded')
  recordStockMovement(dto: any) {
    return this.inventoryService.recordStockMovement(dto);
  }
  @MessagePattern('inventory.getSummary')
  async getInventorySummary(
    @Payload() data: { filter?: string; page?: number; limit?: number },
  ) {
    const { filter, page = 1, limit = 10 } = data;
    return await this.inventoryService.inventorySummary(filter, page, limit);
  }

  @EventPattern('product.deleted')
  async handleProductDeleted(@Payload() data: { productId: number }) {
    this.logger.log(
      `Received product.deleted event: ${JSON.stringify(data)}`,
    );

    const { productId } = data;

    if (!productId) {
      this.logger.error(` Missing productId in event payload`);
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
          ` No inventory record found for Product ID: ${productId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error occurred while deleting inventory for Product ID: ${productId}`,
        error,
      );
    }
  }
}