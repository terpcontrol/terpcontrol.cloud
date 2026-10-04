import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminDeviceCreate, AdminDeviceProvision, Device, DevicePage, ProvisionedDevice } from '@fg2/shared-types/v1';
import { adminDeviceCreate, adminDeviceProvision, device as deviceShape, devicePage, provisionedDevice } from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { AccessContext } from '@common/v1/access.types';
import { Caller } from '@common/v1/access.guard';
import { notFound } from '@common/v1/problem';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { DeviceRegistrationService } from '@modules/device-protocol/device-registration.service';
import { V1Answer } from '../answer-shape';
import { DevicesService } from './devices.service';

/**
 * The devices as an operator sees them: every one of them, whoever owns it, and
 * the row made for hardware that has not been flashed yet - by hand, or with the
 * credentials the provisioning tool flashes into it.
 */
@ApiTags('admin')
@Controller('v1/admin/devices')
@UseGuards(AdminGuard)
export class AdminDevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly registration: DeviceRegistrationService,
  ) {}

  /**
   * Every device on the install, whoever owns it - the fleet, and the support
   * search over it. `GET /devices` answers an administrator as the person they
   * are; this is the office.
   */
  @Get()
  @ApiOperation({ summary: 'Every device' })
  @V1Answer(devicePage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: PageQuery): Promise<DevicePage> {
    return this.devices.list(ctx, query, undefined, true);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a device row by hand' })
  @V1Answer(deviceShape, { status: HttpStatus.CREATED })
  public async create(@V1Body(adminDeviceCreate) body: AdminDeviceCreate): Promise<Device> {
    return this.devices.serialise(await this.devices.createAsAdmin(body));
  }

  /**
   * What `./provision-fw.sh` flashes: a new device with its id, the serial
   * number printed on its label and the broker credentials it signs in with.
   * The row made by hand above has no credentials, and a device flashed without
   * them has nothing to connect with.
   */
  @Post('provisioned')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a device to flash, with its broker credentials' })
  @V1Answer(provisionedDevice, { status: HttpStatus.CREATED })
  public async provision(@V1Body(adminDeviceProvision) body: AdminDeviceProvision): Promise<ProvisionedDevice> {
    const made = await this.registration.provision(body.classId, body.type);
    if (!made) throw notFound('device_class_not_found', 'There is no device class with that id.');

    return { device: this.devices.serialise(made.device), mqtt: { username: made.username, password: made.password } };
  }
}
