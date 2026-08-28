import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { logger } from '@utils/logger';
import { loggablePath } from './common/log-path';
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
      const path = loggablePath(request.url);
      logger.info(
        `${request.ip} ${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms "${request.headers['user-agent'] ?? ''}"`,
      );
      done();
    });
};
