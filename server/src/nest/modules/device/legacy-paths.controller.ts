import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { deviceService } from '@services/device.service';
import { sendFirmwareBinary } from './device-firmware.controller';

/**
 * The paths older firmware builds were shipped with. They stay until no device
 * in the field asks for them any more, and are left out of the API docs so they
 * do not read as something new clients should use.
 */
@ApiExcludeController()
@Controller('auth/v0.0.1/device')
export class LegacyDevicePathsController {
  @Post('claimcode')
  @HttpCode(HttpStatus.OK)
  public async claimCode(@Body() body: { device_id?: string; password?: string }) {
    const code = await deviceService.getClaimCode(body?.device_id, body?.password);

    if (code === false) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return code;
  }

  @Get('firmware/:firmware_id/:binary')
  public async download(
    @Param('firmware_id') firmwareId: string,
    @Param('binary') binaryName: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await sendFirmwareBinary(reply, await deviceService.getFirmwareBinary(firmwareId, binaryName));
  }
}
