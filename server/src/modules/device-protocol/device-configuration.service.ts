import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceConfiguration } from '@fg2/shared-types/v1';
import { HttpException } from '@common/http-exception';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
// The plan hands over what its step stored; the port it asks through is the plan's.
import { DeviceConfigurationWriter } from '../v1/plan/device-configuration.port';
import { DevicePublisherService } from './device-publisher.service';

/**
 * The configuration document, which is the device's own.
 *
 * The cloud stores a copy and hands it back; the device decides what it means
 * and which keys exist, and the server never validates or interprets one. A key
 * the device does not know is ignored, and disappears the next time the device
 * uploads its settings - which is why nothing here adds anything to what it is
 * given.
 *
 * The device sends no acknowledgement and no echo, so a save is what was stored
 * and sent, never what the device is now running: it reports that itself, when a
 * setting is changed on the device.
 */
@Injectable()
export class DeviceConfigurationService implements DeviceConfigurationWriter {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly publisher: DevicePublisherService,
  ) {}

  /** The whole document, as a client writes it. */
  public replace(deviceId: string, configuration: DeviceConfiguration): Promise<boolean> {
    return this.store(deviceId, () => configuration);
  }

  /**
   * A plan step's settings, merged into what the device runs. The merge is by
   * top-level key, so a step that carries the whole document replaces it and one
   * that carries a section replaces that section - which is what the plan screen
   * has always written.
   */
  public applyConfiguration(deviceId: string, settings: DeviceConfiguration): Promise<boolean> {
    // Nothing to merge, or nothing to merge into, is no write: the firmware reads
    // every key a document leaves out as its compile-time default, so sending
    // either would reset tuning the cloud has no copy of.
    return this.store(deviceId, current =>
      !current || Object.keys(current).length === 0 || Object.keys(settings).length === 0 ? null : { ...current, ...settings },
    );
  }

  private async store(deviceId: string, next: (current: DeviceConfiguration | null) => DeviceConfiguration | null): Promise<boolean> {
    // Asked before anything is written: a caller that cannot be served should
    // find nothing changed, rather than a stored configuration it was told had
    // failed and a device that goes on running the old one.
    if (!this.publisher.canPublish) {
      throw new HttpException(503, 'Not connected to the message broker');
    }

    const device = await this.devices.findOne({ id: deviceId }, { configuration: 1 }).lean<Pick<StoredDevice, 'configuration'> | null>();
    if (!device) {
      throw new HttpException(404, 'Device not found');
    }

    const configuration = next(device.configuration ?? null);
    if (configuration === null) return false;
    await this.devices.updateOne({ id: deviceId }, { $set: { configuration } });

    // Not required after the write: the device asks for its configuration when
    // it connects and is answered from what is stored, so a send that fails
    // between the check above and here costs a delay, not the setting.
    this.publisher.configuration(deviceId, configuration);

    return JSON.stringify(device.configuration) !== JSON.stringify(configuration);
  }
}
