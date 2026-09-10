import { Module } from '@nestjs/common';
import { ModelsModule } from '../../database/models.module';
import { ChartPresetController } from './chart-preset.controller';
import { ChartPresetService } from './chart-preset.service';

@Module({
  imports: [ModelsModule],
  controllers: [ChartPresetController],
  providers: [ChartPresetService],
})
export class ChartPresetModule {}
