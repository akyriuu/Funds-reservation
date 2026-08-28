import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';

export class CaptureHoldDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents?: number;
}