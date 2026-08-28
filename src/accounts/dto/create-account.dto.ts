import { IsIn, IsOptional } from 'class-validator';

export class CreateAccountDto { 
    @IsOptional()
    @IsIn(['BRL', 'USD', 'EUR'])
    currency: string = 'BRL';
}