import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { DeviceClass, DeviceFirmware, UserFirmwareList } from '@fg2/shared-types';
import { HttpException } from '@exceptions/HttpException';
import { deviceService } from '@services/device.service';
import { AdminGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { AddDeviceClass, addDeviceClassSchema, AddFirmware, addFirmwareSchema } from './device.schemas';

/** Streams a stored binary the way the OTA client expects to read it. */
export const sendFirmwareBinary = async (reply: FastifyReply, binary: Buffer): Promise<void> => {
  await reply
    .header('Content-Disposition', 'attachment; filename=firmware.bin')
    .header('Content-Type', 'application/octet-stream')
    .header('Content-Length', binary.length)
    .header('Cache-Control', 'no-transform')
    .send(binary);
};

@ApiTags('firmware')
@Controller('device')
export class DeviceFirmwareController {
  @Get('firmware')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Every firmware record' })
  public list(): Promise<DeviceFirmware[]> {
    return deviceService.findAllFirmware();
  }

  @Get('firmware/find')
  @UseGuards(AdminGuard)
  @ApiQuery({ name: 'name', required: true, description: 'The device class the firmware was built for' })
  @ApiQuery({ name: 'version', required: true })
  @ApiOperation({ summary: 'Find a firmware by class and version' })
  public async find(@Query('name') name: string, @Query('version') version: string): Promise<DeviceFirmware> {
    const firmware = await deviceService.findFirmwareByNameVersion(name, version);

    if (!firmware) {
      throw new NotFoundException({ status: 'not found' });
    }

    return firmware;
  }

  @Post('firmware')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Register a firmware build' })
  public async create(@Body(zodBody(addFirmwareSchema)) body: AddFirmware) {
    const firmware = await deviceService.createFirmware(body.name, body.version);
    return { firmware_id: firmware.firmware_id, name: firmware.name, version: firmware.version };
  }

  @Post('firmware/:firmware_id/:binary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one of the images that make up a firmware build' })
  public async upload(@Param('firmware_id') firmwareId: string, @Param('binary') binaryName: string, @Body() body: { binary?: unknown }) {
    if (!Buffer.isBuffer(body?.binary)) {
      throw new HttpException(400, 'Binary file is missing or invalid');
    }

    const firmware = await deviceService.createFirmwareBinary(firmwareId, binaryName, body.binary);
    return { firmware_id: firmware.firmware_id, name: firmware.name };
  }

  // No session: the device fetches its own update over plain HTTP, and the
  // firmware id is the only thing it has.
  @Get('firmware/:firmware_id/:binary')
  @ApiOperation({ summary: 'Download a firmware image' })
  public async download(@Param('firmware_id') firmwareId: string, @Param('binary') binaryName: string, @Res() reply: FastifyReply): Promise<void> {
    await sendFirmwareBinary(reply, await deviceService.getFirmwareBinary(firmwareId, binaryName));
  }

  @Put('firmware/:firmware_id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Relabel a firmware build' })
  public async relabel(@Param('firmware_id') firmwareId: string, @Body() body: { version?: unknown }) {
    const version = typeof body?.version === 'string' ? body.version.trim() : '';
    if (!version) {
      throw new HttpException(400, 'Missing or invalid version');
    }

    const firmware = await deviceService.updateFirmwareVersion(firmwareId, version);
    return { firmware_id: firmware.firmware_id, name: firmware.name, version: firmware.version };
  }

  @Delete('firmware/:firmware_id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete a firmware build and its images' })
  public async remove(@Param('firmware_id') firmwareId: string) {
    await deviceService.deleteFirmware(firmwareId);
    return { status: 'ok' };
  }

  @Get('firmwares/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'The firmware versions this device can run' })
  public forDevice(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string): Promise<UserFirmwareList> {
    return deviceService.listFirmwaresForDevice(deviceId, user.userId, user.isDemo);
  }

  @Get('class')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Every device class' })
  public listClasses(): Promise<DeviceClass[]> {
    return deviceService.listClasses();
  }

  @Get('class/find/:class_name')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Find a device class by name' })
  public async findClass(@Param('class_name') className: string): Promise<DeviceClass> {
    const deviceClass = await deviceService.findClass(className);

    if (!deviceClass) {
      throw new NotFoundException({ status: 'not found' });
    }

    return deviceClass;
  }

  @Get('class/:class_id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'One device class, by id' })
  public getClass(@Param('class_id') classId: string): Promise<DeviceClass> {
    return deviceService.getClass(classId);
  }

  @Post('class')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create a device class' })
  public async createClass(@Body(zodBody(addDeviceClassSchema)) body: AddDeviceClass) {
    await deviceService.createClass(
      body.name,
      body.description,
      body.concurrent,
      body.maxfails,
      body.firmware_id,
      body.beta_firmware_id,
      body.alpha_firmware_id,
    );
    return { status: 'ok' };
  }

  @Post('class/:class_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Change a device class, including the firmware each channel points at' })
  public async updateClass(@Param('class_id') classId: string, @Body(zodBody(addDeviceClassSchema)) body: AddDeviceClass) {
    await deviceService.updateClass(
      classId,
      body.name,
      body.description,
      body.concurrent,
      body.maxfails,
      body.firmware_id,
      body.beta_firmware_id,
      body.alpha_firmware_id,
    );
    return { status: 'ok' };
  }
}
