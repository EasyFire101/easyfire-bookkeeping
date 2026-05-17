import { ApiPropertyOptional } from '@nestjs/swagger';

export class InventoryAdjustmentsFilterDto {
  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 12 })
  pageSize?: number;
}
