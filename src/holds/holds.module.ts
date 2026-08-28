import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { HoldsController } from './holds.controller';
import { HoldsExpiration } from './holds-expiration.service';
import { HoldsService } from './holds.service';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';


@Module({
    imports: [LedgerModule, IdempotencyModule],
    controllers: [HoldsController],
    providers: [HoldsService, HoldsExpiration],
    exports: [HoldsService, HoldsExpiration],
})
export class HoldsModule {}