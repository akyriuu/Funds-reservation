import { IsInt, IsPositive, Max } from 'class-validator';

export class CreditAmountDto { 
    @IsInt()
    @IsPositive()
    @Max(Number.MAX_SAFE_INTEGER)
    amountCents: number;
}