import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { ZodBody } from '@common/zod-validation.pipe';
import { PUBLIC_OPERATION } from '../../openapi';
import { DeviceRegistered, DeviceRegistrationService, IssuedClaimCode } from './device-registration.service';
import { FirmwareImageService } from './firmware-image.service';
import { ClaimCodeRequest, claimCodeSchema, RegisterDeviceRequest, registerDeviceSchema } from './protocol.schemas';

/**
 * Everything a device asks for over HTTP. Three routes, none of them
 * authenticated in the HTTP sense, all of them frozen: the paths, the bodies,
 * the status codes and the answers are what firmware in the field expects, and
 * not every device will take an update.
 *
 * They sit beside `/v1` rather than under it, because the base URL is compiled
 * into every build that has shipped.
 */

/** Streams a stored image the way the OTA client reads it. */
const sendFirmwareImage = async (reply: FastifyReply, image: Buffer): Promise<void> => {
  await reply
    .header('Content-Disposition', 'attachment; filename=firmware.bin')
    .header('Content-Type', 'application/octet-stream')
    // The device sizes its update partition from this, so only the bytes it will
    // write are erased; without it the whole partition goes, and a flaky link
    // can stall the download while it does.
    .header('Content-Length', image.length)
    .header('Cache-Control', 'no-transform')
    .send(image);
};

@ApiTags('device-protocol')
@Controller('device')
export class DeviceProtocolController {
  constructor(
    private readonly registration: DeviceRegistrationService,
    private readonly firmware: FirmwareImageService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'What firmware calls to enrol itself with this cloud', ...PUBLIC_OPERATION })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The build the device is to install, which is what makes it a device of this cloud.',
    schema: { type: 'object', required: ['fw'], properties: { fw: { type: 'string' } } },
  })
  public async register(@ZodBody(registerDeviceSchema) body: RegisterDeviceRequest): Promise<DeviceRegistered> {
    const registered = await this.registration.register(body);

    if (!registered) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return registered;
  }

  @Post('claimcode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask a device for a fresh claim code', ...PUBLIC_OPERATION })
  @ApiOkResponse({
    description: 'The code the display shows.',
    schema: { type: 'object', required: ['claim_code'], properties: { claim_code: { type: 'string' } } },
  })
  public async claimCode(@ZodBody(claimCodeSchema) body: ClaimCodeRequest): Promise<IssuedClaimCode> {
    const code = await this.registration.issueClaimCode(body);

    if (!code) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return code;
  }

  // No session: the device fetches its own update over plain HTTP, and the
  // firmware id is the only thing it has.
  @Get('firmware/:firmware_id/:binary')
  @ApiOperation({ summary: 'Download a firmware image', ...PUBLIC_OPERATION })
  @ApiOkResponse({
    description: 'The image, as the OTA client reads it.',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  public async download(@Param('firmware_id') firmwareId: string, @Param('binary') binaryName: string, @Res() reply: FastifyReply): Promise<void> {
    await sendFirmwareImage(reply, await this.firmware.read(firmwareId, binaryName));
  }
}

/**
 * The paths older builds were shipped with. No build in this repository calls
 * them; they stay until no device in the field asks for them any more, and are
 * left out of the API document so they do not read as something to use.
 */
@ApiExcludeController()
@Controller('auth/v0.0.1/device')
export class LegacyDeviceProtocolController {
  constructor(
    private readonly registration: DeviceRegistrationService,
    private readonly firmware: FirmwareImageService,
  ) {}

  @Post('claimcode')
  @HttpCode(HttpStatus.OK)
  public async claimCode(@ZodBody(claimCodeSchema) body: ClaimCodeRequest): Promise<IssuedClaimCode> {
    const code = await this.registration.issueClaimCode(body);

    if (!code) {
      throw new UnauthorizedException({ status: 'unauthorized' });
    }

    return code;
  }

  @Get('firmware/:firmware_id/:binary')
  public async download(@Param('firmware_id') firmwareId: string, @Param('binary') binaryName: string, @Res() reply: FastifyReply): Promise<void> {
    await sendFirmwareImage(reply, await this.firmware.read(firmwareId, binaryName));
  }
}
