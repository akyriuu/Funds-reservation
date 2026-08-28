import { 
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { toAccountResponse } from './accounts.presenter';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreditAmountDto } from './dto/credit-amount.dto';

@Controller('accounts')
export class AccountsController { 
    constructor(private readonly accounts: AccountsService) {}

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(@Body() dto: CreateAccountDto) { 
        return toAccountResponse(await this.accounts.create(dto));
    }

    @Get(':id')
    async get(@Param('id') id: string) { 
        return toAccountResponse(await this.accounts.get(id));  
      }


      @Post(':id/deposits')
      @HttpCode(HttpStatus.CREATED)

      async credit(@Param('id') id: string, @Body() dto: CreditAmountDto) { 
        return toAccountResponse(await this.accounts.credit(id, dto));
      }
}