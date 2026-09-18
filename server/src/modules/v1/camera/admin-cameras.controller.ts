import { Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Camera, CameraEntitlementUpdate } from '@fg2/shared-types/v1';
import { camera, cameraEntitlementUpdate } from '@fg2/shared-types/v1-schemas';
import { AdminGuard } from '@common/auth/auth.guard';
import { V1Body } from '@common/zod-validation.pipe';
import { notFound } from '@common/v1/problem';
import { CamerasService } from './cameras.service';
import { V1Answer } from '../answer-shape';

/**
 * The only writer of an entitlement. Nothing in this server renews one on its
 * own and nothing else grants one: a camera's twelve months are set where it is
 * first paired or created, and everything after that is this route.
 */
@ApiTags('admin')
@Controller('v1/admin/cameras')
export class AdminCamerasController {
  constructor(private readonly cameras: CamerasService) {}

  @Put(':id/entitlement')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set how long a camera is entitled, and by what' })
  @V1Answer(camera)
  public async set(@Param('id') id: string, @V1Body(cameraEntitlementUpdate) body: CameraEntitlementUpdate): Promise<Camera> {
    const updated = await this.cameras.setEntitlement(id, {
      validUntil: body.validUntil === null ? null : new Date(body.validUntil),
      grant: body.grant,
    });
    if (!updated) throw notFound('camera_not_found', 'There is no camera with that id.');

    return this.cameras.serialise(updated);
  }
}
