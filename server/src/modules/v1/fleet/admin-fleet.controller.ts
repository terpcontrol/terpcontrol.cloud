import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AdminStats,
  DeviceClass,
  DeviceClassCreate,
  DeviceClassPage,
  DeviceClassUpdate,
  Firmware,
  FirmwareBinaryUpload,
  FirmwareCreate,
  FirmwarePage,
  FirmwareUpdate,
  Fleet,
} from '@fg2/shared-types/v1';
import {
  adminStats as adminStatsShape,
  deviceClass as deviceClassShape,
  deviceClassCreate,
  deviceClassPage,
  deviceClassUpdate,
  firmware as firmwareShape,
  firmwareBinaryUpload,
  firmwareCreate,
  firmwarePage,
  firmwareUpdate,
  fleet as fleetShape,
} from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { badRequest } from '@common/v1/problem';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { AdminStatsService } from './admin-stats.service';
import { FleetService, serialiseClass } from './fleet.service';

/**
 * The fleet, as an operator and the firmware build container work it.
 *
 * Nothing here belongs to a person: a class and a build are the cloud's own, and
 * what they decide reaches every device of that class - so these are the only
 * routes of `/v1` behind the admin guard rather than behind `access()`.
 */

const firmwareListQuery = pageQuery.extend({ classId: z.string().optional() });

@ApiTags('admin')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminFleetController {
  constructor(
    private readonly fleet: FleetService,
    private readonly health: AdminStatsService,
  ) {}

  @Get('fleet')
  @ApiOperation({ summary: 'What the fleet is running, class by class' })
  @V1Answer(fleetShape)
  public overview(): Promise<Fleet> {
    return this.fleet.fleet();
  }

  /**
   * How the install itself is doing. It sits beside the fleet rather than under
   * the accounts because it is read on the same screen and answers the same
   * question: whether anything here has quietly stopped working.
   */
  @Get('stats')
  @ApiOperation({ summary: "The install's own figures: its accounts, its hardware, its pictures and its background work" })
  @V1Answer(adminStatsShape)
  public stats(): Promise<AdminStats> {
    return this.health.stats();
  }

  @Get('device-classes')
  @ApiOperation({ summary: 'Every device class' })
  @V1Answer(deviceClassPage)
  public listClasses(@V1Query(pageQuery) query: PageQuery): Promise<DeviceClassPage> {
    return this.fleet.listClasses(query);
  }

  @Post('device-classes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a device class' })
  @V1Answer(deviceClassShape, { status: HttpStatus.CREATED })
  public createClass(@V1Body(deviceClassCreate) body: DeviceClassCreate): Promise<DeviceClass> {
    return this.fleet.createClass(body);
  }

  @Get('device-classes/:id')
  @ApiOperation({ summary: 'One device class' })
  @V1Answer(deviceClassShape)
  public async readClass(@Param('id') id: string): Promise<DeviceClass> {
    return serialiseClass(await this.fleet.requireClass(id));
  }

  /** Where a build is rolled out: pointing a channel at one is a change to the class. */
  @Patch('device-classes/:id')
  @ApiOperation({ summary: 'Change a device class, the build each channel points at included' })
  @V1Answer(deviceClassShape)
  public updateClass(@Param('id') id: string, @V1Body(deviceClassUpdate) body: DeviceClassUpdate): Promise<DeviceClass> {
    return this.fleet.updateClass(id, body);
  }

  @Get('firmwares')
  @ApiOperation({ summary: 'Every registered build' })
  @V1Answer(firmwarePage)
  public listFirmwares(@V1Query(firmwareListQuery) query: z.infer<typeof firmwareListQuery>): Promise<FirmwarePage> {
    return this.fleet.listFirmwares(query, query.classId);
  }

  @Post('firmwares')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a build' })
  @V1Answer(firmwareShape, { status: HttpStatus.CREATED })
  public createFirmware(@V1Body(firmwareCreate) body: FirmwareCreate): Promise<Firmware> {
    return this.fleet.createFirmware(body);
  }

  @Patch('firmwares/:id')
  @ApiOperation({ summary: 'Relabel a build' })
  @V1Answer(firmwareShape)
  public updateFirmware(@Param('id') id: string, @V1Body(firmwareUpdate) body: FirmwareUpdate): Promise<Firmware> {
    return this.fleet.updateFirmware(id, body);
  }

  @Delete('firmwares/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a build and its files' })
  @ApiNoContentResponse({ description: 'The build is gone.' })
  public removeFirmware(@Param('id') id: string): Promise<void> {
    return this.fleet.removeFirmware(id);
  }

  /**
   * One file of a build, by the name the device asks for it under. The bytes
   * travel base64-encoded, which is what a JSON body can carry; the contract
   * says so and the device is served the decoded file.
   */
  @Put('firmwares/:id/binaries/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upload one of the files that make up a build' })
  @ApiNoContentResponse({ description: 'The file is stored.' })
  public async uploadBinary(
    @Param('id') id: string,
    @Param('name') name: string,
    @V1Body(firmwareBinaryUpload) body: FirmwareBinaryUpload,
  ): Promise<void> {
    await this.fleet.storeBinary(id, name, decodeBinary(body.data));
  }
}

/**
 * `data` is what JSON can carry a firmware image as. A string that is not base64
 * decodes to something shorter than it claims rather than failing, so the
 * round trip is what says whether the upload arrived intact - a truncated image
 * is an update that bricks nothing but wastes an OTA window on every device.
 */
const decodeBinary = (data: unknown): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data !== 'string') throw badRequest('binary_missing', 'The file is sent as base64 under `data`.');

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '')) {
    throw badRequest('binary_not_base64', 'The file did not arrive as valid base64.');
  }

  return bytes;
};
