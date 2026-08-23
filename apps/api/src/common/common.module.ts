import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Shared primitives every other module may depend on. Global, so a feature
 * module gets PrismaService without importing this one explicitly.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class CommonModule {}
