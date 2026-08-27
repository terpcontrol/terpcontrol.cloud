import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LOG_FORMAT } from '@config';
import { logger } from '@utils/logger';

/**
 * One line per request, through the same logger the rest of the server writes
 * to. `LOG_FORMAT=disabled` turns it off, which is what the test harness and
 * anything that reads the logs of a busy deployment want.
 */
export const registerAccessLog = (app: NestFastifyApplication): void => {
  if (LOG_FORMAT === 'disabled') return;

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', (request, reply, done) => {
      logger.info(
        `${request.ip} ${request.method} ${request.url} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms "${
          request.headers['user-agent'] ?? ''
        }"`,
      );
      done();
    });
};
