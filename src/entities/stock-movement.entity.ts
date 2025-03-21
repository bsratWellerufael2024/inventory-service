// import {
//   Entity,
//   PrimaryGeneratedColumn,
//   Column,
//   CreateDateColumn,
// } from 'typeorm';

// @Entity({ name: 'stock_movements' })
// export class StockMovement {
//   @PrimaryGeneratedColumn()
//   id: number; 

//   @Column()
//   productId: number; 

//   @Column({ nullable: true })
//   variantId: number; 

//   @Column({ type: 'enum', enum: ['IN', 'OUT'] })
//   type: 'IN' | 'OUT'; 
//   @Column({ type: 'int' })
//   quantity: number; 
//   @Column({ type: 'varchar', length: 255, nullable: true })
//   reason: string;

//   @Column({ type: 'timestamp',default: () => 'CURRENT_TIMESTAMP'  })
//   movementDate: Date; 

//   @CreateDateColumn({ type: 'timestamp' })
//   createdAt: Date; 

//   @Column({default:1})
//   activatedBy: number; 
// }

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'stock_movements' })
export class StockMovement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  productId: number;

  @Column({ nullable: true })
  variantId: number;

  @Column({ type: 'enum', enum: ['IN', 'OUT'] })
  type: 'IN' | 'OUT';

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  movementDate: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 255 }) // Change from number to string
  activatedBy: string;
}
