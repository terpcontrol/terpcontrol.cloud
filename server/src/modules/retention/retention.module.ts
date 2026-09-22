import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { ClimateRetentionService } from './climate-retention.service';

/**
 * What the retention windows on an account and on a tent actually do.
 *
 * It is a sweep and one question: it reads the windows out of the two
 * collections that hold them and the samples out of the measurement store, and
 * the only thing anything else asks it is what its last pass did - which the
 * fleet's health card prints, because this is the one job on an install that
 * deletes a grower's raw data.
 */
@Module({
  imports: [ModelsModule, DataModule],
  providers: [ClimateRetentionService],
  exports: [ClimateRetentionService],
})
export class RetentionModule {}
