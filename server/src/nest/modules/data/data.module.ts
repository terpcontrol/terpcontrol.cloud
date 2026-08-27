import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { dataServiceProvider } from './data.provider';

@Module({
  controllers: [DataController],
  providers: [dataServiceProvider],
})
export class DataModule {}
