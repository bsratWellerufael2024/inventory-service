import { Controller } from "@nestjs/common";
import { MessagePattern } from "@nestjs/microservices";
import { InventoryService } from "src/services/inventory.service";
import { Inject } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Payload } from "@nestjs/microservices";
@Controller()
export class InventoryController {
  constructor(
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
}