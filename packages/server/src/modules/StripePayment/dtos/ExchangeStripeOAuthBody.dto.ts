import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ExchangeStripeOAuthBodyDto {
  @ApiProperty({
    description: 'Authorization code returned by Stripe OAuth',
    example: 'ac_xxx',
  })
  @IsString()
  code: string;
}
