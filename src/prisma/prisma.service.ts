import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
    {   
    
        constructor(config: ConfigService) { 
            super({
                adapter: new PrismaPg({
                    connectionString: config.getOrThrow<string>('DATABASE_URL'),
                    max: Number(config.get<string>('DATABASE_POOL_MAX') ?? 20 ),
                }),
            });
        }


        async onModuleInit(): Promise<void> { 
            await this.$connect();
        }

        async onModuleDestroy(): Promise<void> { 
            await this.$disconnect();
        }
    }