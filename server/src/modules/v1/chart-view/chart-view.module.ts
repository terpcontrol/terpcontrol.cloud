import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { ChartViewsController } from './chart-views.controller';
import { ChartViewsService } from './chart-views.service';

/**
 * The charts somebody saved to come back to.
 *
 * It depends on nothing that answers a series, and that is deliberate: a view is
 * only the question. Whether the devices and the grow it names may still be read
 * is settled when the chart is drawn, by the routes that draw it.
 */
@Module({
  imports: [ModelsModule, V1CommonModule],
  controllers: [ChartViewsController],
  providers: [ChartViewsService],
})
export class ChartViewModule {}
