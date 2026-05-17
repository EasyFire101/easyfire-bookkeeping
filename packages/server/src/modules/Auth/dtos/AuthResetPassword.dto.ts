import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthResetPasswordDto {
  @ApiProperty({
    example: 'new-password',
    description: 'New password',
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
