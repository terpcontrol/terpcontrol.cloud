import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Alarm, CloudSettings, Device } from '@fg2/shared-types';
import { deviceService } from '@services/device.service';
import { AdminGuard, AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceIdFrom, DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { zodBody } from '../../common/zod-validation.pipe';
import {
  AddDevice,
  addDeviceSchema,
  ClaimDevice,
  claimDeviceSchema,
  ConfigureDevice,
  configureDeviceSchema,
  RegisterDevice,
  registerDeviceSchema,
  SetName,
  setNameSchema,
  TestDevice,
  testDeviceSchema,
} from './device.schemas';

const OK = { status: 'ok' } as const;

@ApiTags('devices')
@Controller('device')
export class DeviceController {
  @Get('all')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Every device in the system' })
  public all(): Promise<Device[]> {
    return deviceService.findAllDevices();
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create a device record from a device class' })
  public create(@Body(zodBody(addDeviceSchema)) body: AddDevice): Promise<Device> {
    return deviceService.create(body);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'What firmware calls on first boot to enrol itself' })
  public async register(@Body(zodBody(registerDeviceSchema)) body: RegisterDevice) {
    const device = await deviceService.register(body);

    if (device === false) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return device;
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The devices the caller owns' })
  public mine(@CurrentUser() user: AuthContext): Promise<Device[]> {
    return deviceService.findUserDevices(user.userId, user.isDemo);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Claim a device with the code it printed' })
  public async claim(@CurrentUser() user: AuthContext, @Body(zodBody(claimDeviceSchema)) body: ClaimDevice) {
    const deviceId = await deviceService.claimDevice(body.claim_code, user.userId);

    if (!deviceId) {
      throw new BadRequestException({ status: 'invalid claim code or device not found' });
    }

    return { status: 'ok', device_id: deviceId };
  }

  @Post('claimcode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask a device for a fresh claim code' })
  public async claimCode(@Body() body: { device_id?: string; password?: string }) {
    const code = await deviceService.getClaimCode(body?.device_id, body?.password);

    if (code === false) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return code;
  }

  @Get('byserial')
  @UseGuards(AdminGuard)
  @ApiQuery({ name: 'serialnumber', required: true })
  @ApiOperation({ summary: 'Find a device by the serial number on its label' })
  public bySerial(@Query('serialnumber') serialnumber: string): Promise<Device> {
    return deviceService.getDeviceBySerial(parseInt(serialnumber));
  }

  @Get('onlinedevices')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'How many devices of each class are online' })
  public online() {
    return deviceService.findOnlineDevices();
  }

  @Get('firmwareversions')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Which firmware versions the fleet is running' })
  public firmwareVersions() {
    return deviceService.getFirmwareVersions();
  }

  @Get('config/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'The configuration the device is running' })
  public async config(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string, @Res() reply: FastifyReply): Promise<void> {
    const configuration = await deviceService.getDeviceConfig(deviceId, user.userId, user.isAdmin, user.isDemo);
    // The configuration is a JSON document the device owns, stored and handed
    // back as a string. Sending it as a JSON string keeps clients parsing it
    // the way they always have.
    await reply.type('application/json; charset=utf-8').send(JSON.stringify(configuration));
  }

  @Post('configure')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Send a new configuration to the device' })
  public async configure(@CurrentUser() user: AuthContext, @Body(zodBody(configureDeviceSchema)) body: ConfigureDevice) {
    await deviceService.configureDevice(body.device_id, user.userId, body.configuration);
    return OK;
  }

  @Get('alarms/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'The alarms defined for the device' })
  public alarms(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string) {
    return deviceService.getDeviceAlarms(deviceId, user.userId, user.isAdmin, user.isDemo);
  }

  @Post('alarms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Replace the alarms of a device' })
  public async setAlarms(@CurrentUser() user: AuthContext, @Body() body: { device_id: string; alarms: Alarm[] }) {
    await deviceService.setDeviceAlarms(body.device_id, user.userId, body.alarms);
    return OK;
  }

  @Get('cloudsettings/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'What the cloud knows about the device, and how it is set up' })
  public async cloudSettings(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string) {
    const settings = await deviceService.getDeviceAccessInfo(deviceId, user.userId, user.isAdmin, user.isDemo);

    if (!settings) {
      throw new NotFoundException({ status: 'not found' });
    }

    return settings;
  }

  @Post('cloudsettings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Change the cloud-side settings of a device' })
  public async setCloudSettings(@CurrentUser() user: AuthContext, @Body() body: { device_id: string; cloud_settings: CloudSettings }) {
    await deviceService.setDeviceCloudSettings(body.device_id, user.userId, body.cloud_settings);
    return OK;
  }

  @Post('setname')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Rename a device' })
  public async setName(@CurrentUser() user: AuthContext, @Body(zodBody(setNameSchema)) body: SetName) {
    await deviceService.setDeviceName(body.device_id, user.userId, body.name);
    return OK;
  }

  @Post('test/:device_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'Drive the outputs by hand, to check the wiring' })
  public async testMode(@Param('device_id') deviceId: string, @Body(zodBody(testDeviceSchema)) body: TestDevice) {
    await deviceService.testOutputs(deviceId, body);
    return OK;
  }

  @Delete('test/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'Hand the outputs back to the device' })
  public async stopTest(@Param('device_id') deviceId: string) {
    await deviceService.stopTest(deviceId);
    return OK;
  }

  @Post('maintenancemode')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Suppress alarms while somebody is working on the tent' })
  public async maintenanceMode(@Body() body: { device_id: string; duration_minutes?: number }) {
    await deviceService.activateMaintenanceMode(body.device_id, body.duration_minutes || 0);
    return OK;
  }

  @Post('reboot')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Restart the device' })
  public async reboot(@Body() body: { device_id: string }) {
    await deviceService.rebootDevice(body.device_id);
    return OK;
  }

  @Post('auxcommand')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Command a smart socket or the camera the device manages' })
  public async auxCommand(
    @Body() body: { device_id: string; action: string; role: string; ip?: string; user?: string; password?: string; slot?: number; append?: boolean },
  ) {
    await deviceService.sendAuxDeviceCommand(body.device_id, body.action, body.role, {
      ip: body.ip,
      user: body.user,
      password: body.password,
      slot: body.slot,
      append: body.append,
    });
    return OK;
  }

  // Last of the /device routes: a bare parameter would otherwise swallow the
  // static ones above it.
  @Delete(':device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'Release a device, so somebody else can claim it' })
  public async unclaim(@Param('device_id') deviceId: string) {
    await deviceService.unClaimDevice(deviceId);
    return OK;
  }
}
