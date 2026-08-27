import { connect, connection, set } from 'mongoose';
import { NODE_ENV } from '@config';
import { dbConnection } from '@databases';
import { logger } from '@utils/logger';

/**
 * Connects before the first request can arrive. The models are module-level
 * mongoose models, so this has to happen once, up front, rather than per module.
 */
export const connectToDatabase = async (): Promise<void> => {
  if (NODE_ENV !== 'production') {
    set('debug', true);
  }

  await connect(dbConnection.url, dbConnection.options);
  logger.info(`MongoDB connected (readyState ${connection.readyState})`);
};
