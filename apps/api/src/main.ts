import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { patchBigIntSerialization } from './common/bigint-serialization';
import { EnvironmentVariables } from './common/env.validation';
import { configureTrustProxy } from './common/trust-proxy';

async function bootstrap() {
  // Before the app exists, so no response can be built without it.
  patchBigIntSerialization();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // Before the first request, so no request is ever keyed on the proxy's
  // address instead of the caller's.
  configureTrustProxy(app, config.get('TRUSTED_PROXY_HOPS', { infer: true }));

  // The global ValidationPipe and exception filter are registered in
  // CommonModule via APP_PIPE / APP_FILTER, not here, so that tests booting
  // AppModule get the same request pipeline production does.

  // Without this, SIGINT/SIGTERM kill the process before any onModuleDestroy
  // runs, and the Postgres and Redis connections are dropped rather than
  // closed.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}
void bootstrap();
