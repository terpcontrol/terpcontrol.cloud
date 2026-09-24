import { Inject, Injectable, Module } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { ModelsModule } from '@database/models.module';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { logger } from '@utils/logger';
import { AppliedPreset, ClimatePresets } from '../grow/climate-presets.port';
import { targetsOf } from '../phase/phase-targets';
import { DEVICE_CONFIGURATION_WRITER, DeviceConfigurationWriter } from '../plan/device-configuration.port';
import { presetConfiguration } from './climate-presets';

/**
 * Putting the controllers of a space on a climate preset, and nothing else.
 *
 * It is on its own, in a module of its own, because it is asked from both sides:
 * `POST /spaces/{id}/preset-applications` writes a preset and then decides what
 * it means for the grow standing here, and a grow entering a phase with a preset
 * of its own asks for the write through `CLIMATE_PRESETS`. Keeping the two in
 * one class would make the grow slice and the space slice each wait for the
 * other to be built.
 */
@Injectable()
export class ClimatePresetsService implements ClimatePresets {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Inject(DEVICE_CONFIGURATION_WRITER) private readonly configuration: DeviceConfigurationWriter,
  ) {}

  public applyToSpace(spaceId: string, stage: GrowthStage, preset: string): Promise<AppliedPreset[]> {
    return this.writeTo(spaceId, stage, preset);
  }

  /**
   * Only the devices that state day and night targets at all: a plug, a light
   * and a fan have nothing a climate could be written to. A device the broker
   * could not be told about costs the others nothing - the tent is put on the
   * preset as far as it can be, and the answer says which parts of it were.
   *
   * What the hardware reported is read with the document, because one figure of
   * the preset depends on it: a controller that says it has no CO2 sensor is one
   * whose firmware holds the target at zero, so the preset's CO2 row is left out
   * for that device rather than stored as a target nothing runs.
   */
  public async writeTo(spaceId: string, stage: GrowthStage, preset: string | null): Promise<AppliedPreset[]> {
    const here = await this.devices.find({ spaceId }, { id: 1, configuration: 1, 'state.hardware': 1 }).lean<StoredDevice[]>();
    const applied: AppliedPreset[] = [];

    for (const device of here) {
      const settings =
        targetsOf(device.configuration) === null
          ? null
          : presetConfiguration(stage, preset, device.configuration, device.state?.hardware?.co2 === 'on');
      if (!settings) continue;

      try {
        await this.configuration.applyConfiguration(device.id, settings);
      } catch (error) {
        logger.error(`Could not put device ${device.id} on the ${stage} preset: ${error}`);
        continue;
      }

      applied.push({ deviceId: device.id, targets: targetsOf({ ...device.configuration, ...settings }) });
    }

    return applied;
  }
}

/**
 * Its own module, so that the write can be bound to `CLIMATE_PRESETS` where the
 * slices are joined without dragging the space routes - and with them the grow
 * slice, which is what asks through that token - into the binding.
 */
@Module({
  imports: [ModelsModule],
  providers: [ClimatePresetsService],
  exports: [ClimatePresetsService],
})
export class ClimatePresetsModule {}
