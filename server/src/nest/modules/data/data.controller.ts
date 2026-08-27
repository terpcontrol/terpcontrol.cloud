import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DeviceAccessGuard } from '../../common/auth/device-access.guard';
import { DATA_SERVICE, DataServiceContract } from './data.provider';

@ApiTags('measurements')
@Controller('data')
@UseGuards(DeviceAccessGuard)
export class DataController {
  constructor(@Inject(DATA_SERVICE) private readonly data: DataServiceContract) {}

  @Get('series/:device_id/:measure')
  // A 201 for a read is odd, but it is what every client of this endpoint expects.
  @HttpCode(HttpStatus.CREATED)
  @ApiQuery({ name: 'from', required: false, description: 'Flux time literal, e.g. -3d or an RFC3339 timestamp' })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'interval', required: false, description: 'Window size, e.g. 5m' })
  @ApiQuery({ name: 'method', required: false, enum: ['mean', 'min', 'max', 'sum'] })
  @ApiOperation({ summary: 'One aggregated point per interval, empty windows included' })
  public series(
    @Param('device_id') deviceId: string,
    @Param('measure') measure: string,
    @Query() query: { from?: string; to?: string; interval?: string; method?: string },
  ) {
    // `String(undefined)` is what the Express controller passed on, and the
    // service reads anything it does not know as the default aggregation.
    return this.data.getSeries(deviceId, measure, query.from, query.to, query.interval, String(query.method));
  }

  @Get('latest/:device_id/:measure')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'The most recent value of the last five minutes' })
  public async latest(@Param('device_id') deviceId: string, @Param('measure') measure: string) {
    return { value: await this.data.getLatest(deviceId, measure) };
  }
}
