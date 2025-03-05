import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'stock_movements' })
export class StockMovement {
  @PrimaryGeneratedColumn()
  id: number; // Auto-incremented Primary Key

  @Column()
  productId: number; // Foreign Key (links to Product Table in another service)

  @Column({ nullable: true })
  variantId: number; // Foreign Key (links to Variant Table if applicable)

  @Column({ type: 'enum', enum: ['IN', 'OUT'] })
  type: 'IN' | 'OUT'; // "IN" for stock added, "OUT" for stock removed

  @Column({ type: 'int' })
  quantity: number; // Number of items moved in or out

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string; // Reason for movement (e.g., "Purchase", "Sale", "Return", etc.)

  @Column({ type: 'timestamp' })
  movementDate: Date; // Date when the stock movement happened

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date; // Auto-set timestamp when a record is created

  @Column()
  activatedBy: number; // User ID of the person who initiated the movement
}
