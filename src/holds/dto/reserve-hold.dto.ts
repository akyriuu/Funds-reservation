import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

const THIRTY_DAYS_IN_SECONDS = 2_592_000;

export class ReserveHoldDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  amountCents: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(THIRTY_DAYS_IN_SECONDS)
  expiresInSeconds?: number;
}