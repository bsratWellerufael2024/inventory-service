import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly mailerService: MailerService) {}

  /**
   * Generic reusable email sending method
   */
  async sendEmail({
    to,
    subject,
    html,
    text,
  }: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    try {
      const response = await this.mailerService.sendMail({
        to,
        subject,
        html,
        text: text || this.stripHtml(html),
      });

      this.logger.log(
        `📧 Email sent successfully to ${to} | Subject: ${subject}`,
      );
      this.logger.debug(`Email service response: ${JSON.stringify(response)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}`, error.stack);
    }
  }
  async sendLowStockAlert(
    to: string,
    productName: string,
    stock: number,
  ): Promise<void> {
    const subject = `Low Stock Alert: ${productName}`;
    const html = `<p>The stock for <strong>${productName}</strong> is low. Only <strong>${stock}</strong> left.</p>`;
    const text = `The stock for ${productName} is low. Only ${stock} left.`;

    await this.sendEmail({ to, subject, html, text });
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
