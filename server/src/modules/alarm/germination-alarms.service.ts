import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { germinationChoicesOf } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DeviceGerminationSink } from '@modules/device-protocol/device-sinks';
import { AlarmEngineService } from './alarm-engine.service';
import { StageAlarmsService } from './stage-alarms.service';

/**
 * What germination does to the alarms, the moment a device germinates or the
 * grower has chosen about it (owner's decision G2), rather than at its next
 * reading.
 *
 * Asked to warn, the device gets the stage's "too humid" where it has none, so
 * the switch that promises a warning over germination's line has a rule to
 * keep it with: germination set from Steuerung, the operating mode or a plan
 * writes no stage bands. Asked not to, an open episode of that rule goes quiet
 * with the save - its own and every other sensor's of the place.
 */
@Injectable()
export class GerminationAlarmsService implements DeviceGerminationSink {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly stages: StageAlarmsService,
    private readonly engine: AlarmEngineService,
  ) {}

  public async germinationChanged(deviceId: string): Promise<void> {
    const device = await this.devices
      .findOne({ id: deviceId }, { 'configuration.workmode': 1, germinationChoices: 1, ownerId: 1, spaceId: 1 })
      .lean<Pick<StoredDevice, 'configuration' | 'germinationChoices' | 'ownerId' | 'spaceId'> | null>();
    // A device nobody owns is hardware on a bench: nothing watches it, so nothing is written for it.
    if (!device?.ownerId || device.configuration?.workmode !== 'breed') return;

    if (germinationChoicesOf(device.germinationChoices).warnTooHumid) return this.stages.ensureTooHumid(deviceId);
    // Germination is the place's: a lamp module's or a fan's "too humid" there rests with the device's own.
    const place = device.spaceId ? await this.devices.find({ spaceId: device.spaceId }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>() : [];
    for (const id of new Set([deviceId, ...place.map(one => one.id)])) await this.engine.restNow(id);
  }
}
