import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { ClimateRetentionService } from './climate-retention.service';

/**
 * What the retention windows on an account and on a tent actually do.
 *
 * It is a sweep and nothing else: no route, nothing to inject anywhere. It
 * reads the windows out of the two collections that hold them and the samples
 * out of the measurement store, and the rest of the server never asks it
 * anything.
 */
@Module({
  imports: [ModelsModule, DataModule],
  providers: [ClimateRetentionService],
})
export class RetentionModule {}
