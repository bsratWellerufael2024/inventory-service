import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'inventory' })
export class Inventory {
  @PrimaryGeneratedColumn()
  id: number; // Auto-generated Primary Key

  @Column()
  productId: number; // Foreign Key (Linked to Product in another DB)

  @Column({ type: 'int', default: 0 })
  quantityAvailable: number; // Available stock quantity

  @Column({ type: 'int', default: 5 })
  lowStockThreshold: number; // Low stock warning threshold

  @Column({ type: 'timestamp', nullable: true })
  lastRestocked: Date; // Last time inventory was restocked

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date; // Auto-set when a record is created

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date; // Auto-set when a record is updated

  @Column({ nullable: true })
  productCode: string;

  @Column({ nullable: true })
  productName: string;
}
