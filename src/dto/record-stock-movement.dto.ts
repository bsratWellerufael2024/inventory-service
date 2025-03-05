import { IsEnum, IsInt, IsOptional, IsString, IsDate } from 'class-validator';

export class RecordStockMovementDto {
  @IsInt()
  productId: number;

  @IsInt()
  @IsOptional()
  variantId?: number;

  @IsEnum(['IN', 'OUT'])
  type: 'IN' | 'OUT';

  @IsInt()
  quantity: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsDate()
  movementDate: Date;

  @IsInt()
  activatedBy: number;
}
