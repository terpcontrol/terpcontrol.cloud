import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { SpaceLive, SpaceLiveDevice } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '@modules/data/data.service';
import { liveOfDevice, mergeLive } from './space-live';

/**
 * The newest reading of every device standing in a space, as one answer. One
 * Influx query per device, which is the cost the home screen pays per card; the
 * home reads every space's devices in one go and hands them in, so it pays it
 * once per device and not once per space per device.
 */
@Injectable()
export class SpaceLiveService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    private readonly data: DataService,
  ) {}

  /**
   * In the order they were claimed, which is the order a card lists them in.
   *
   * The hardware report comes with them because a target is only a target where
   * something can measure whether it is being held: the CO2 setpoint of a
   * controller with no sensor fitted is a figure the tent cannot be judged on,
   * and it is dropped where the device itself says there is none.
   */
  public async devicesIn(spaceIds: string[]): Promise<StoredDevice[]> {
    return this.devices
      .find({ spaceId: { $in: spaceIds } }, { id: 1, spaceId: 1, configuration: 1, createdAt: 1, 'state.hardware': 1 })
      .sort({ createdAt: 1, id: 1 })
      .lean<StoredDevice[]>();
  }

  public readingsOf(devices: StoredDevice[]): Promise<SpaceLiveDevice[]> {
    return Promise.all(devices.map(async device => liveOfDevice({ device, reading: await this.data.live(device.id) })));
  }

  public async liveOf(spaceId: string): Promise<SpaceLive> {
    const [devices, cameras] = await Promise.all([
      this.devicesIn([spaceId]).then(rows => this.readingsOf(rows)),
      this.cameras.find({ spaceId, removedAt: null }, { id: 1, 'state.lastStillAt': 1 }).lean<CameraDocument[]>(),
    ]);

    return {
      spaceId,
      ...mergeLive(devices),
      devices,
      cameras: cameras.map(camera => ({ cameraId: camera.id, lastStillAt: camera.state.lastStillAt?.toISOString() ?? null })),
    };
  }
}
