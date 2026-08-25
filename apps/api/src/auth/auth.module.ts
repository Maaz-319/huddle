import { Module } from '@nestjs/common';
import { PrismaUserRepository } from './adapters/prisma-user-repository.adapter';
import { UserRepository } from './user-repository.interface';

/**
 * Identity and sessions. Phase 1 delivers only the persistence seam: the
 * `UserRepository` port and its Prisma adapter, as the reference port/adapter
 * pair every later module copies. `AuthService`, the OAuth flow, the controller
 * and `SessionStore` are Phase 3.
 *
 * The binding below is the whole pattern: consumers depend on the abstract
 * `UserRepository`, and swapping Postgres for something else is a new adapter
 * class and a changed `useClass` — nothing above the port moves.
 */
@Module({
  providers: [{ provide: UserRepository, useClass: PrismaUserRepository }],
  exports: [UserRepository],
})
export class AuthModule {}
