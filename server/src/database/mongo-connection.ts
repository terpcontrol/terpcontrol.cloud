import { ConfigType } from '@nestjs/config';
import { databaseConfig } from '../config/configuration';

/**
 * Where the database is and how to sign in to it, said once.
 *
 * The server opens this connection through Nest, and the migration command-line
 * entry point opens the same one for itself without Nest at all - so a
 * connection string written twice is a connection string that drifts.
 */
export const mongoConnectionSettings = (database: ConfigType<typeof databaseConfig>) => ({
  uri: `mongodb://${database.host}:${database.port}/${database.name}`,
  authSource: 'admin',
  user: database.user,
  pass: database.password,
});
