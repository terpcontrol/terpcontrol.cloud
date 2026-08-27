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
import { setupOpenApi } from './openapi';

// The device-facing work runs on timers and MQTT callbacks; an error in one of
// them must not take the API down with it.
process.on('uncaughtException', (error, origin) => {
  logger.error(`Uncaught exception (${origin}): ${error?.stack ?? error}`);
});

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// The API is called from the webapp on another origin, and it is read from
// there with every verb the routes offer - not just the three a preflight
// allows by default.
const ALLOWED_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

/**
 * What is worth compressing. This is the plugin's own default set with
 * `application/octet-stream` taken out: firmware images go to an OTA client
 * that reads Content-Length and is served `Cache-Control: no-transform`, and
 * compressing them drops the first and ignores the second.
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
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // Uploaded files arrive as buffers on the body, which is the shape the
  // picture and firmware endpoints work with. The cap is well above the largest
  // firmware image; the endpoints enforce their own, smaller limits.
  await app.register(fastifyMultipart, { attachFieldsToBody: 'keyValues', limits: { fileSize: MAX_UPLOAD_BYTES } });
  await app.register(fastifyCookie);
  await app.register(fastifyCors, { methods: ALLOWED_METHODS });
  await app.register(fastifyHelmet, {
    // Pictures are loaded straight into <img> tags on the webapp's origin, so
    // they must stay readable across origins.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(fastifyCompress, { customTypes: COMPRESSIBLE_TYPES });

  registerAccessLog(app);
  setupOpenApi(app);

  await app.listen(PORT ?? 3000, '0.0.0.0');
  logger.info(`API listening on port ${PORT ?? 3000}`);
};

void bootstrap();
