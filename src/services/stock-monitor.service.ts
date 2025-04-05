import { Injectable, Logger } from '@nestjs/common';
import { Cron} from '@nestjs/schedule'; // 👈 Import cron decorator
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { NotificationService } from './notification.service';

@Injectable()
export class StockMonitorService {
  private readonly logger = new Logger(StockMonitorService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

   @Cron('0 0 */2 * *') // 👈 Runs every 2 days
   async checkLowStock() {
   const lowStockThreshold = 5;

    try {
      const lowStockItems = await this.inventoryRepo.find({
        where: { quantityAvailable: LessThan(lowStockThreshold) },
      });

      this.logger.log(`Fetched ${lowStockItems.length} low stock items`);

      if (lowStockItems.length === 0) {
        return;
      }

      const emailBody = this.buildLowStockEmail(lowStockItems);
      const emailTo = this.configService.get<string>('LOW_STOCK_ALERT_EMAIL');
      await this.notificationService.sendEmail({
        to: emailTo,
        subject: '⚠️ Low Stock Alert Summary',
        html: emailBody,
      });

      this.logger.log('Low stock summary email sent.');
    } catch (error) {
      this.logger.error('Error checking low stock:', error);
    }
  }

  private buildLowStockEmail(items: Inventory[]): string {
    const tableRows = items
      .map(
        (item) => `
        <tr>
          <td>${item.productName || 'N/A'}</td>
          <td>${item.productCode || 'N/A'}</td>
          <td>${item.quantityAvailable}</td>
        </tr>
      `,
      )
      .join('');

    return `
      <h2>Low Stock Alert</h2>
      <p>The following products are currently below the minimum stock threshold:</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Product Name</th>
            <th>Product Code</th>
            <th>Quantity Available</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <p>Please take appropriate action.</p>
    `;
  }
}
