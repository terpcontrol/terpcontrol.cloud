import { Controller, Delete, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Plant, PlantUpdate } from '@fg2/shared-types/v1';
import { plant as plantShape, plantUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, CurrentGrant, Requires } from '@common/v1/access.guard';
import { Grant } from '@common/v1/access.types';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { GrowsService } from './grows.service';

/**
 * A single plant, addressed without its grow.
 *
 * It has a life of its own - it is trained, moved, harvested and weighed - and
 * every one of those names it by id, so correcting one is not a detour through
 * the grow it happens to be in. `access()` resolves a plant to that grow all the
 * same, so who may do this is decided by exactly the same facts.
 */
@ApiTags('grows')
@Controller('v1/plants')
export class PlantsController {
  constructor(private readonly grows: GrowsService) {}

  /**
   * The weights are editable here as well as through a harvest, because a dry
   * weight is typed in days later and corrected more than once.
   */
  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'plant')
  @ApiOperation({ summary: 'Rename a plant, or record what it weighed' })
  @V1Answer(plantShape)
  public async update(@CurrentGrant() grant: Grant, @Param('id') id: string, @V1Body(plantUpdate) body: PlantUpdate): Promise<Plant> {
    return this.grows.updatePlant(id, body, await this.grows.redaction(grant));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'plant')
  @ApiOperation({ summary: 'Remove a plant from a grow' })
  @ApiNoContentResponse({ description: 'The plant is gone.' })
  public remove(@Param('id') id: string): Promise<void> {
    return this.grows.removePlant(id);
  }
}
