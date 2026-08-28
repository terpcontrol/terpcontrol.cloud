import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { logger } from '@utils/logger';
import { appConfig } from './config/configuration';

/**
 * One line per request, through the same logger the rest of the server writes
 * to. `LOG_FORMAT=disabled` turns it off, which is what the test harness and
 * anything that reads the logs of a busy deployment want.
 */
export const registerAccessLog = (app: NestFastifyApplication): void => {
  if (app.get(appConfig.KEY).logFormat === 'disabled') return;

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', (request, reply, done) => {
      // The path only: a picture URL carries the long-lived image token in its
      // query string, and these logs are kept for a month.
      const path = request.url.split('?')[0];
      logger.info(
        `${request.ip} ${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms "${request.headers['user-agent'] ?? ''}"`,
      );
      done();
    });
};
