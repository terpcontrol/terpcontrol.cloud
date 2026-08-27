import 'reflect-metadata';
import { createServer } from 'node:http';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyInstance } from 'fastify';
import { PORT } from '@config';
import { logger } from '@utils/logger';
import validateEnv from '@utils/validateEnv';
import { AppModule } from './app.module';
import { createDispatcher, createLegacyApp, NodeHandler } from './legacy-fallback';

const bootstrap = async (): Promise<void> => {
  validateEnv();

  // Connects to MongoDB and builds the Express tree that still owns the routes
  // NestJS has not taken over.
  const legacy = await createLegacyApp();

  // The dispatcher needs the router, which only exists once Nest has built the
  // application; it is read per request, not captured up front.
  let fastify: FastifyInstance | undefined;

  const adapter = new FastifyAdapter({
    serverFactory: handler => createServer(createDispatcher(() => fastify, handler as NodeHandler, legacy)),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: false });
  fastify = app.getHttpAdapter().getInstance();

  // The same protections the Express tree applies, so a migrated route is not
  // quietly less protected than the one it replaced.
  await app.register(fastifyCookie);
  await app.register(fastifyCors);
  await app.register(fastifyHelmet);
  await app.register(fastifyCompress);

  await app.listen(PORT ?? 3000, '0.0.0.0');
  logger.info(`API listening on port ${PORT ?? 3000}`);
};

void bootstrap();
