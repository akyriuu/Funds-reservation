import { Controller, Get, Param, Query } from '@nestjs/common'; 
import { ListEntriesDto } from './dto/list-entries.dto';
import { toEntryResponse } from './ledger.presenter';
import { LedgerService } from './ledger.service';

@Controller('accounts/:accountId/ledger')
export class LedgerController { 
    constructor(private readonly ledger: LedgerService ) {}

    @Get()
    async list(
        @Param('accountId') accountId: string,
        @Query() query: ListEntriesDto,
    ) { 
        const entries = await this.ledger.list(accountId, query);
        return { data: entries.map(toEntryResponse)  }
    }
}