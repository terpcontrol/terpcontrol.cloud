import 'reflect-metadata';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { logger } from '@utils/logger';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';
import { registerAccessLog } from './access-log';
import { registerHttpCompatibility } from './http-compatibility';
import { setupOpenApi } from './openapi';

// How long the log transports get to write the reason down before the process
// goes. They write to a local file, so this is generous.
const FLUSH_BEFORE_EXIT_MS = 1000;

/**
 * A throw that reached nobody - the device-facing work runs on timers and MQTT
 * callbacks, where there is no caller to return an error to. Each of those
 * paths catches its own failures; anything that gets here is a bug, and it
 * leaves the server in a state nothing has reasoned about: a half-updated map,
 * a subscription that is no longer running. Serving on is worse than the few
 * seconds a restart costs, and both pm2 and the container are set to restart.
 *
 * Registering a handler at all is what stops node ending the process itself, so
 * ending it is this handler's job.
 */
process.on('uncaughtException', (error, origin) => {
  const reason = `Uncaught exception (${origin}): ${error?.stack ?? error}`;
  // stderr as well: it is the one channel that cannot be lost to a transport
  // that has not flushed by the time the process is gone.
  process.stderr.write(`${reason}\n`);
  logger.error(reason);

  setTimeout(() => process.exit(1), FLUSH_BEFORE_EXIT_MS).unref();
});

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// SIGTERM is how a container is asked to stop; SIGINT is Ctrl-C in a terminal.
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

// The API is called from the webapp on another origin, and it is read from
// there with every verb the routes offer - not just the three a preflight
// allows by default.
const ALLOWED_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];

/**
 * What is worth compressing: the plugin's own default pattern with
 * `octet-stream` removed from the end of it.
 *
 * That pattern lists octet-stream explicitly, and a type it matches is
 * compressed without further question - so replacing it, which is what passing
 * `customTypes` does, is what leaves firmware images alone. (Declining here
 * then falls through to mime-db, which also calls them incompressible.) It
 * matters because the OTA client reads Content-Length and is served
 * `Cache-Control: no-transform`, and compressing drops the first and ignores
 * the second. A test in `http-contract.spec.ts` holds the download to it.
 */
const COMPRESSIBLE_TYPES = /^text\/(?!event-stream)|(?:\+|\/)json(?:;|$)|(?:\+|\/)text(?:;|$)|(?:\+|\/)xml(?:;|$)/u;

/**
 * Closes the app when the process is asked to stop, which is what runs every
 * provider's shutdown hook: the broker connection, the database connection and
 * the timers that read cameras and walk grow plans all go there.
 *
 * Written out rather than left to `enableShutdownHooks()` so the stop has a
 * beginning and an end in the log. The two look identical from outside until
 * the container runtime loses patience, and one of them means a handle is being
 * held that nothing is going to release.
 */
const stopOnSignal = (app: NestFastifyApplication): void => {
  let stopping = false;

  for (const signal of STOP_SIGNALS) {
    process.once(signal, () => {
      if (stopping) {
        return;
      }
      stopping = true;

      logger.info(`Stopping on ${signal}`);

      app
        .close()
        .catch(error => logger.error(`Stopping did not finish cleanly: ${error?.stack ?? error}`))
        .finally(() => {
          logger.info(`Stopped on ${signal}`);

          // The transports write to a file, and re-raising the signal ends the
          // process where they are - so without this the last line of a stop
          // would be the one most likely to be lost.
          setTimeout(() => {
            // Nothing is listening for it now, so the default disposition ends
            // the process - which is what Nest's own handler does once its own
            // hooks have run.
            process.kill(process.pid, signal);
            // Deliberately not unref'd: an empty event loop would otherwise
            // end the process before the write, which is the case this is for.
          }, FLUSH_BEFORE_EXIT_MS);
        });
    });
  }
};

const bootstrap = async (): Promise<void> => {
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

  stopOnSignal(app);

  registerHttpCompatibility(app);
  registerAccessLog(app);
  setupOpenApi(app);

  // The environment was validated as the module was built, so this is a number.
  const { port } = app.get(appConfig.KEY);

  await app.listen(port, '0.0.0.0');
  logger.info(`API listening on port ${port}`);
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
