import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { EnvironmentVariables } from './env.validation';
import { LoggerService } from './logger.service';

/**
 * The injectable Prisma client, and the only place the database connection is
 * opened or closed.
 *
 * Prisma 7 is Rust-free: it reaches Postgres through a driver adapter that is
 * handed to the client at construction, rather than through a connection URL
 * in the schema. PrismaClient itself is imported from the generated folder,
 * never from `@prisma/client`.
 *
 * Boundary rule, from docs/architecture/repo-structure.md section 5: only
 * `adapters/*.adapter.ts` files may inject this. A `*.service.ts` never does —
 * that is what keeps Prisma swappable behind the ports.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger: LoggerService;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    logger: LoggerService,
  ) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
    this.logger = logger;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PrismaService', 'Connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
