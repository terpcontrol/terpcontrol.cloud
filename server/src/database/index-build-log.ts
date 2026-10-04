import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { logger } from '@utils/logger';

/**
 * Says so when an index is not built.
 *
 * The indexes of this server are declared on the schemas and built by mongoose
 * itself at boot (`autoIndex`), and a build that fails is kept quiet: mongoose
 * puts a `catch` on the promise its `init()` answers and reports the failure by
 * emitting an `index` event on the model, which nothing listens to. A duplicate
 * key in existing data, or an index that differs from one the collection already
 * carries, would therefore leave the collection without it and the log without a
 * word - and the first anybody would know of it is a read that got slow or a
 * uniqueness that was never enforced.
 *
 * One listener per model, attached before the builds can finish: they need a
 * round trip to the database, and the models are compiled while this module's
 * providers are.
 */
@Injectable()
export class IndexBuildLog implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  public onModuleInit(): void {
    for (const model of Object.values(this.connection.models)) {
      model.on('index', (error?: Error) => {
        if (error) {
          logger.error(`Index build failed on ${model.collection.collectionName} (model ${model.modelName}): ${error}`);
        }
      });
    }
  }
}
