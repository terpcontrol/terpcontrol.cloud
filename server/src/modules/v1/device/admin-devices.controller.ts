import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminDeviceCreate, Device, DevicePage } from '@fg2/shared-types/v1';
import { adminDeviceCreate, device as deviceShape, devicePage } from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { AccessContext } from '@common/v1/access.types';
import { Caller } from '@common/v1/access.guard';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { DevicesService } from './devices.service';

/**
 * The devices as an operator sees them: every one of them, whoever owns it, and
 * the row made by hand for hardware that has not been flashed yet.
 */
@ApiTags('admin')
@Controller('v1/admin/devices')
@UseGuards(AdminGuard)
export class AdminDevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Every device' })
  @V1Answer(devicePage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: PageQuery): Promise<DevicePage> {
    return this.devices.list(ctx, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a device row by hand' })
  @V1Answer(deviceShape, { status: HttpStatus.CREATED })
  public async create(@V1Body(adminDeviceCreate) body: AdminDeviceCreate): Promise<Device> {
    return this.devices.serialise(await this.devices.createAsAdmin(body));
  }
}
