import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    Post,
  } from '@nestjs/common';
  import { CaptureHoldDto } from './dto/capture-hold.dto';
  import { ReserveHoldDto } from './dto/reserve-hold.dto';
  import { toHoldResponse } from './holds.presenter';
  import { HoldsService } from './holds.service';
  import { UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { MissingIdempotencyKeyError } from '../common/idempotency/idempotency.errors';
  
  @Controller('holds')
  export class HoldsController {
    constructor(private readonly holds: HoldsService) {}
  
    @Post()
    @HttpCode(HttpStatus.CREATED)
    async reserve(
      @Body() dto: ReserveHoldDto,
      @Headers('idempotency-key') idempotencyKey?: string,
    ) {
      if (!idempotencyKey) {
        throw new MissingIdempotencyKeyError();
      }
  
      return toHoldResponse(await this.holds.reserve({ ...dto, idempotencyKey }));
    }
  
    @Get(':id')
    async get(@Param('id') id: string) {
      return toHoldResponse(await this.holds.get(id));
    }
  
    
      @Post(':id/capture')
      @HttpCode(HttpStatus.OK)
      @UseInterceptors(IdempotencyInterceptor)
      async capture(@Param('id') id: string, @Body() dto: CaptureHoldDto) {
        return toHoldResponse(await this.holds.capture(id, dto.amountCents));
      }

      @Post(':id/release')
      @HttpCode(HttpStatus.OK)
      @UseInterceptors(IdempotencyInterceptor)
      async release(@Param('id') id: string) {
        return toHoldResponse(await this.holds.release(id));
      }
    }
