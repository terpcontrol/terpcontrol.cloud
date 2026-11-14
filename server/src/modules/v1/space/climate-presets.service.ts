import { Inject, Injectable, Module } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GerminationChoices, GrowthStage } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas';
import { MODEL_V1 } from '@database/models';
import { ModelsModule } from '@database/models.module';
import { AwaitedClimate, StoredDevice } from '@database/schemas/v1/devices.schema';
import { logger } from '@utils/logger';
import { DeviceSettingsSink } from '../../device-protocol/device-sinks';
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
export class ClimatePresetsService implements ClimatePresets, DeviceSettingsSink {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @Inject(DEVICE_CONFIGURATION_WRITER) private readonly configuration: DeviceConfigurationWriter,
  ) {}

  /**
   * Only the devices that state day and night targets at all: a plug, a light
   * and a fan have nothing a climate could be written to. A device the broker
   * could not be told about costs the others nothing - the tent is put on the
   * preset as far as it can be, and the answer says which parts of it were.
   *
   * What the hardware reported is read with the document, because one figure of
   * the preset depends on it: a controller that says it has no CO2 sensor is one
   * whose firmware holds the target at zero, so the preset's CO2 row is left out
   * for that device rather than stored as a target nothing runs. A fridge never
   * says, and always has one: its firmware does not regulate without it.
   *
   * What germination does about the humidity goes with the germination stage
   * alone: a choice about the dark is not one any other climate makes.
   */
  public async applyToSpace(
    spaceId: string,
    stage: GrowthStage,
    preset: string | null,
    choices?: Partial<GerminationChoices>,
  ): Promise<AppliedPreset[]> {
    const here = await this.devices.find({ spaceId }, { id: 1, type: 1, configuration: 1, 'state.hardware': 1 }).lean<StoredDevice[]>();
    const applied: AppliedPreset[] = [];
    const germination = stage === 'germination' ? choices : undefined;

    // A controller or a fridge module that has not sent its settings has nothing to write the climate into yet: it
    // waits for them, and is put on the climate as they arrive (`settingsArrived`) - a phase chosen at the claim
    // before the device first reported was never written, and Start called its own figures "Alles im Ziel".
    const awaiting = here.filter(device => device.configuration === null && OWN_CLIMATE_TYPES.includes(device.type)).map(device => device.id);
    if (awaiting.length > 0) {
      const awaited: AwaitedClimate = { spaceId, stage, preset, choices: germination ?? null };
      await this.devices.updateMany({ id: { $in: awaiting }, configuration: null }, { $set: { awaitedClimate: awaited } });
    }

    for (const device of here) {
      const settings =
        targetsOf(device.configuration) === null
          ? null
          : presetConfiguration(stage, preset, device.configuration, device.type === 'fridge' || device.state?.hardware?.co2 === 'on');
      if (!settings) continue;

      try {
        await this.configuration.applyConfiguration(device.id, settings, stage, germination, { stage, preset });
      } catch (error) {
        logger.error(`Could not put device ${device.id} on the ${stage} preset: ${error}`);
        continue;
      }

      applied.push({ deviceId: device.id, targets: targetsOf({ ...device.configuration, ...settings }) });
    }

    return applied;
  }

  /**
   * A device's first settings have arrived: it is put on the climate its place was put on while it had none, if it
   * still stands there - the climate is the place's, not the device's to take along.
   */
  public async settingsArrived(deviceId: string): Promise<void> {
    const device = await this.devices
      .findOneAndUpdate({ id: deviceId }, { $set: { awaitedClimate: null } })
      .lean<Pick<StoredDevice, 'id' | 'type' | 'spaceId' | 'configuration' | 'state' | 'awaitedClimate'>>();
    const awaited = device?.awaitedClimate ?? null;
    if (!device || !awaited || awaited.spaceId !== device.spaceId) return;

    const settings =
      targetsOf(device.configuration) === null
        ? null
        : presetConfiguration(awaited.stage, awaited.preset, device.configuration, device.type === 'fridge' || device.state?.hardware?.co2 === 'on');
    if (!settings) return;

    try {
      await this.configuration.applyConfiguration(device.id, settings, awaited.stage, awaited.choices ?? undefined, {
        stage: awaited.stage,
        preset: awaited.preset,
      });
    } catch (error) {
      logger.error(`Could not put device ${device.id} on the ${awaited.stage} preset its place waited with: ${error}`);
    }
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
