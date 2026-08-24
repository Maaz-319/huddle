import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { patchBigIntSerialization } from './common/bigint-serialization';

async function bootstrap() {
  // Before the app exists, so no response can be built without it.
  patchBigIntSerialization();

  const app = await NestFactory.create(AppModule);

  // The global ValidationPipe and exception filter are registered in
  // CommonModule via APP_PIPE / APP_FILTER, not here, so that tests booting
  // AppModule get the same request pipeline production does.

  // Without this, SIGINT/SIGTERM kill the process before any onModuleDestroy
  // runs, and the Postgres and Redis connections are dropped rather than
  // closed.
  app.enableShutdownHooks();

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
}
void bootstrap();
