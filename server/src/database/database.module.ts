import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { set } from 'mongoose';
import { logger } from '@utils/logger';
import { appConfig, databaseConfig } from '../config/configuration';

/**
 * The connection, owned by Nest: it is opened before the first module that
 * needs it is constructed and closed on shutdown, which a `connect()` call at
 * the top of `bootstrap` could do neither of.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [databaseConfig.KEY, appConfig.KEY],
      useFactory: (database: ConfigType<typeof databaseConfig>, app: ConfigType<typeof appConfig>) => {
        // Outside production, mongoose logs every query it runs.
        if (app.nodeEnv !== 'production') set('debug', true);

        return {
          uri: `mongodb://${database.host}:${database.port}/${database.name}`,
          authSource: 'admin',
          user: database.user,
          pass: database.password,
          onConnectionCreate: (connection: { readyState: number }) => {
            logger.info(`MongoDB connected (readyState ${connection.readyState})`);
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
