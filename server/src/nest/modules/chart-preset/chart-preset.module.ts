import { Module } from '@nestjs/common';
import { ChartPresetController } from './chart-preset.controller';
import { ChartPresetService } from './chart-preset.service';

@Module({
  controllers: [ChartPresetController],
  providers: [ChartPresetService],
})
export class ChartPresetModule {}
