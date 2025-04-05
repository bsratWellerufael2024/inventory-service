// inventory-service/src/controllers/notification.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from '../services/notification.service';

@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern({ cmd: 'low_stock_alert' })
  async handleLowStockAlert(
    @Payload() data: { to: string; productName: string; stock: number },
  ) {
    await this.notificationService.sendLowStockAlert(
      data.to,
      data.productName,
      data.stock,
    );

    return { success: true };
  }
}
