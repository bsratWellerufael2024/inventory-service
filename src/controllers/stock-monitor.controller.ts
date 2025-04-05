import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
// import { StockMonitorService } from './stock-monitor.service';
import { StockMonitorService } from 'src/services/stock-monitor.service';
@Controller()
export class StockMonitorController {
  constructor(private readonly stockMonitorService: StockMonitorService) {}

  // This listens for the 'check_low_stock' message pattern
  // @MessagePattern('check_low_stock')
  // async handleLowStockCheck() {
  //   await this.stockMonitorService.checkLowStock();
  // }
  @MessagePattern('check_low_stock')
  async handleLowStockCheck() {
    await this.stockMonitorService.checkLowStock();
    // Send a response back to the client to acknowledge the process
    return { success: true, message: 'Low stock check completed' }; // Add this response
  }
}
