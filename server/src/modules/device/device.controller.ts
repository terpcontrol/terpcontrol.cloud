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
import { DeviceService } from './device.service';
import { AdminGuard, AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceIdFrom, DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { zodBody } from '../../common/zod-validation.pipe';
import { PUBLIC_OPERATION } from '../../openapi';
import {
  AddDevice,
  addDeviceSchema,
  ClaimDevice,
  claimDeviceSchema,
  ConfigureDevice,
  configureDeviceSchema,
  MaintenanceMode,
  maintenanceModeSchema,
  RegisterDevice,
  registerDeviceSchema,
  SetAlarms,
  setAlarmsSchema,
  SetCloudSettings,
  setCloudSettingsSchema,
  SetName,
  setNameSchema,
  TestDevice,
  testDeviceSchema,
} from './device.schemas';

const OK = { status: 'ok' } as const;

@ApiTags('devices')
@Controller('device')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Get('all')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Every device in the system' })
  public all(): Promise<Device[]> {
    return this.deviceService.findAllDevices();
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create a device record from a device class' })
  public create(@Body(zodBody(addDeviceSchema)) body: AddDevice): Promise<Device> {
    return this.deviceService.create(body);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'What firmware calls on first boot to enrol itself', ...PUBLIC_OPERATION })
  public async register(@Body(zodBody(registerDeviceSchema)) body: RegisterDevice) {
    const device = await this.deviceService.register(body);

    if (device === false) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return device;
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The devices the caller owns' })
  public mine(@CurrentUser() user: AuthContext): Promise<Device[]> {
    return this.deviceService.findUserDevices(user.userId, user.isDemo);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Claim a device with the code it printed' })
  public async claim(@CurrentUser() user: AuthContext, @Body(zodBody(claimDeviceSchema)) body: ClaimDevice) {
    const deviceId = await this.deviceService.claimDevice(body.claim_code, user.userId);

    if (!deviceId) {
      throw new BadRequestException({ status: 'invalid claim code or device not found' });
    }

    return { status: 'ok', device_id: deviceId };
  }

  @Post('claimcode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask a device for a fresh claim code', ...PUBLIC_OPERATION })
  public async claimCode(@Body() body: { device_id?: string; password?: string }) {
    const code = await this.deviceService.getClaimCode(body?.device_id, body?.password);

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
    return this.deviceService.getDeviceBySerial(parseInt(serialnumber));
  }

  @Get('onlinedevices')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'How many devices of each class are online' })
  public online() {
    return this.deviceService.findOnlineDevices();
  }

  @Get('firmwareversions')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Which firmware versions the fleet is running' })
  public firmwareVersions() {
    return this.deviceService.getFirmwareVersions();
  }

  @Get('config/:device_id')
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'The configuration the device is running' })
  public async config(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string, @Res() reply: FastifyReply): Promise<void> {
    const configuration = await this.deviceService.getDeviceConfig(deviceId, user.userId, user.isAdmin, user.isDemo);
    // The configuration is a JSON document the device owns, stored and handed
    // back as a string. Sending it as a JSON string keeps clients parsing it
    // the way they always have.
    await reply.type('application/json; charset=utf-8').send(JSON.stringify(configuration));
  }

  @Post('configure')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Send a new configuration to the device' })
  public async configure(@Body(zodBody(configureDeviceSchema)) body: ConfigureDevice) {
    await this.deviceService.configureDevice(body.device_id, body.configuration);
    return OK;
  }

  @Get('alarms/:device_id')
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'The alarms defined for the device' })
  public alarms(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string) {
    return this.deviceService.getDeviceAlarms(deviceId, user.userId, user.isAdmin, user.isDemo);
  }

  @Post('alarms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Replace the alarms of a device' })
  public async setAlarms(@Body(zodBody(setAlarmsSchema)) body: SetAlarms) {
    await this.deviceService.setDeviceAlarms(body.device_id, body.alarms as unknown as Alarm[]);
    return OK;
  }

  @Get('cloudsettings/:device_id')
  // No session guard in front: this route has always answered the device check
  // itself, so an anonymous caller gets its refusal rather than a JSON 401.
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'What the cloud knows about the device, and how it is set up' })
  public async cloudSettings(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string) {
    const settings = await this.deviceService.getDeviceAccessInfo(deviceId, user.userId, user.isAdmin, user.isDemo);

    if (!settings) {
      throw new NotFoundException({ status: 'not found' });
    }

    return settings;
  }

  @Post('cloudsettings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Change the cloud-side settings of a device' })
  public async setCloudSettings(@Body(zodBody(setCloudSettingsSchema)) body: SetCloudSettings) {
    await this.deviceService.setDeviceCloudSettings(body.device_id, body.cloud_settings as CloudSettings);
    return OK;
  }

  @Post('setname')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Rename a device' })
  public async setName(@Body(zodBody(setNameSchema)) body: SetName) {
    await this.deviceService.setDeviceName(body.device_id, body.name);
    return OK;
  }

  @Post('test/:device_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Drive the outputs by hand, to check the wiring' })
  public async testMode(@Param('device_id') deviceId: string, @Body(zodBody(testDeviceSchema)) body: TestDevice) {
    await this.deviceService.testOutputs(deviceId, body);
    return OK;
  }

  @Delete('test/:device_id')
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Hand the outputs back to the device' })
  public async stopTest(@Param('device_id') deviceId: string) {
    await this.deviceService.stopTest(deviceId);
    return OK;
  }

  @Post('maintenancemode')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Suppress alarms while somebody is working on the tent' })
  public async maintenanceMode(@Body(zodBody(maintenanceModeSchema)) body: MaintenanceMode) {
    await this.deviceService.activateMaintenanceMode(body.device_id, body.duration_minutes);
    return OK;
  }

  @Post('reboot')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Restart the device' })
  public async reboot(@Body() body: { device_id: string }) {
    await this.deviceService.rebootDevice(body.device_id);
    return OK;
  }

  @Post('auxcommand')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @DeviceIdFrom('body')
  @ApiOperation({ summary: 'Command a smart socket or the camera the device manages' })
  public async auxCommand(
    @Body() body: { device_id: string; action: string; role: string; ip?: string; user?: string; password?: string; slot?: number; append?: boolean },
  ) {
    await this.deviceService.sendAuxDeviceCommand(body.device_id, body.action, body.role, {
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
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Release a device, so somebody else can claim it' })
  public async unclaim(@Param('device_id') deviceId: string) {
    await this.deviceService.unClaimDevice(deviceId);
    return OK;
  }
}
