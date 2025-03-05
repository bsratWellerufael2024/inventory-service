import { Controller } from "@nestjs/common";
import { MessagePattern } from "@nestjs/microservices";
import { InventoryService } from "src/services/inventory.service";

@Controller()
export class InventoryController{
    constructor(private inventoryService:InventoryService){}
    @MessagePattern('movement_recorded')
    recordStockMovement(dto:any){
         return this.inventoryService.recordStockMovement(dto)
    }
}