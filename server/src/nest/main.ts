import 'reflect-metadata';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PORT } from '@config';
import { logger } from '@utils/logger';
import validateEnv from '@utils/validateEnv';
import { AppModule } from './app.module';
import { connectToDatabase } from './database';
import { registerAccessLog } from './access-log';
import { registerHttpCompatibility } from './http-compatibility';
import { setupOpenApi } from './openapi';

// The device-facing work runs on timers and MQTT callbacks, where a throw has
// no caller to reach. This is the record it leaves: the logger's error
// transport handles exceptions itself and ends the process once it has flushed
// them, so the supervisor restarts a server left in an unknown state.
process.on('uncaughtException', (error, origin) => {
  logger.error(`Uncaught exception (${origin}): ${error?.stack ?? error}`);
});

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// The API is called from the webapp on another origin, and it is read from
// there with every verb the routes offer - not just the three a preflight
// allows by default.
const ALLOWED_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

/**
 * What is worth compressing. Handing the plugin a pattern replaces its own
 * judgement rather than adding to it, so this is its default set with
 * `application/octet-stream` taken out: firmware images go to an OTA client
 * that reads Content-Length and is served `Cache-Control: no-transform`, and
 * compressing them drops the first and ignores the second. A test in
 * `http-contract.spec.ts` holds the firmware download to that.
 */
const COMPRESSIBLE_TYPES = /^text\/(?!event-stream)|(?:\+|\/)json(?:;|$)|(?:\+|\/)text(?:;|$)|(?:\+|\/)xml(?:;|$)/u;

const bootstrap = async (): Promise<void> => {
  validateEnv();
  await connectToDatabase();

  const adapter = new FastifyAdapter({
    // Behind a single nginx reverse proxy: trust exactly the hop it adds, so
    // rate limiting sees the real client address and the session cookie knows
    // whether the original request was HTTPS. Trusting the whole chain instead
    // would let a caller pick its own rate-limit bucket by sending a header.
    trustProxy: (_address: string, hop: number) => hop === 0,
    routerOptions: {
      // Express matched a trailing slash; a client that has been calling
      // `/device/` for years should not start getting 404s.
      ignoreTrailingSlash: true,
      // And it matched without regard to case, which the same clients rely on.
      caseSensitive: false,
      // Fastify caps a path segment at 100 characters, Express did not. The MQTT
      // auth secret travels in the path, and a long one would 414 every check
      // the broker makes - which is every device in the field, at once.
      maxParamLength: 4096,
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // Uploaded files arrive as buffers on the body, which is the shape the
  // picture and firmware endpoints work with. The cap is well above the largest
  // firmware image; a diary photo is refused later, once converting it has
  // shown whether the result still fits in its document.
  await app.register(fastifyMultipart, { attachFieldsToBody: 'keyValues', limits: { fileSize: MAX_UPLOAD_BYTES } });
  await app.register(fastifyCookie);
  await app.register(fastifyCors, { methods: ALLOWED_METHODS });
  await app.register(fastifyHelmet, {
    // Pictures are loaded straight into <img> tags on the webapp's origin, so
    // they must stay readable across origins.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyCompress, { customTypes: COMPRESSIBLE_TYPES });

  registerHttpCompatibility(app);
  registerAccessLog(app);
  setupOpenApi(app);

  await app.listen(PORT ?? 3000, '0.0.0.0');
  logger.info(`API listening on port ${PORT ?? 3000}`);
};

bootstrap().catch(error => {
  // A failure to start is fatal, and has to be: the process manager only
  // restarts a container that exits, and the handler above would otherwise
  // leave this one alive with nothing listening. The reason goes to stderr as
  // well, because the logger's transports flush after this process is gone.
  const reason = `Failed to start: ${error?.stack ?? error}`;
  // stderr first, and synchronously: it is the one channel that cannot be lost
  // to a transport that flushes after this process is gone.
  process.stderr.write(`${reason}\n`);
  logger.error(reason);
  process.exit(1);
});
