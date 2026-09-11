import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Device, DeviceLog } from '@fg2/shared-types';
import { toDate } from '../../common/to-date';
import { MODEL } from '../../database/models.module';

/** What an entry carries, whether it was written by a device, a client or the server. */
export interface DeviceLogEntry {
  /** An entry carries a message, a title, or both. */
  message?: string;
  title?: string;
  severity: number;
  raw?: boolean;
  categories: string[];
  data?: Record<string, any>;
  images?: string[];
  deleted?: boolean;
  /** Epoch milliseconds from a client, an ISO string from the device. */
  time?: string | number | Date;
}

/**
 * The grow diary: the entries a device, a client or the server writes about one
 * device, and the reads and edits over them.
 *
 * It is a module of its own rather than part of the device module because the
 * things that watch a device - alarms, the webcam poller, the grow plans - all
 * write entries. Reaching them through the device service is what made those
 * modules refer back to it, and the device module refer to them in turn.
 */
@Injectable()
export class DeviceLogService {
  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceLog) private readonly deviceLogs: Model<DeviceLog & Document>,
  ) {}

  public async logMessage(deviceId: string, msg: DeviceLogEntry) {
    await this.deviceLogs.create({
      device_id: deviceId,
      message: msg.message,
      title: msg.title || msg.message,
      severity: msg.severity,
      raw: msg.raw,
      categories: msg.categories || [],
      data: msg.data,
      images: msg.images,
      deleted: msg.deleted,
      time: toDate(msg.time),
    });
  }

  /**
   * Writes a diary lifecycle entry when a grow plan moves the device into a new
   * stage. Comparing against the previously logged stage keeps repeated stages
   * (e.g. two consecutive flowering steps) and plain re-saves from spamming the
   * grow diary.
   */
  public async logStageTransitionIfChanged(deviceId: string, stage: string) {
    const lastEntry = await this.deviceLogs
      .findOne({ device_id: deviceId, categories: 'diary-plant-lifecycle', deleted: { $ne: true } })
      .sort({ time: -1 });

    if (lastEntry?.data?.newLifecycleStage === stage) {
      return;
    }

    await this.logMessage(deviceId, {
      title: 'message-diary-plant-lifecycle',
      message: '',
      severity: 0,
      categories: ['diary-plant-lifecycle'],
      data: {
        newLifecycleStage: stage,
        // Keep the grow report's cycle grouping intact by carrying the plant
        // name of the running cycle forward.
        ...(lastEntry?.data?.lifecycleName ? { lifecycleName: lastEntry.data.lifecycleName } : {}),
      },
    });
  }

  public async getDeviceLogs(device_id: string, timestampFrom: number, timestampTo: number, deleted: boolean, categories?: string[]) {
    // Access (ownership, admin, or share link) was already authorized by the controller.
    const device = await this.devices.findOne({ device_id: device_id }, { device_id: 1 });
    if (device) {
      const logs = await this.deviceLogs
        .find({
          device_id: device_id,
          ...(timestampTo || timestampFrom
            ? {
                time: {
                  ...(timestampFrom ? { $gte: new Date(timestampFrom) } : {}),
                  ...(timestampTo ? { $lt: new Date(timestampTo) } : {}),
                },
              }
            : {}),
          ...(deleted ? {} : { deleted: { $ne: true } }),
          ...(categories ? { categories: { $in: categories } } : {}),
        })
        .sort({ time: -1 })
        // Plain objects, so callers may hand out reduced copies of an entry.
        .lean();
      logs.forEach(log => (log.categories = log.categories?.length > 0 ? log.categories : ['unknown']));
      return logs.reverse();
    }
    return [];
  }

  public async deleteDeviceLogs(device_id: string, user_id: string) {
    const device = await this.devices.findOne({ device_id: device_id, owner_id: user_id }, { device_id: 1 });
    if (device) {
      await this.deviceLogs.updateMany({ device_id: device_id }, { $set: { deleted: true } });
    }
  }

  public async deleteDeviceLog(device_id: string, user_id: string, is_admin: boolean, log_id: string) {
    const device = await this.findAccessibleDevice(device_id, user_id, is_admin);

    if (device) {
      await this.deviceLogs.deleteOne({ _id: log_id, device_id: device_id });
    }
  }

  public async updateDeviceLog(device_id: string, user_id: string, is_admin: boolean, log_id: string, payload: DeviceLogEntry) {
    if (!(await this.findAccessibleDevice(device_id, user_id, is_admin))) {
      return;
    }

    const update: Record<string, any> = {
      title: payload.title,
      message: payload.message,
      raw: payload.raw,
      severity: payload.severity,
      categories: payload.categories,
      data: payload.data,
      images: payload.images,
      deleted: payload.deleted,
    };

    if (payload.time) {
      update.time = toDate(payload.time);
    }

    await this.deviceLogs.updateOne({ _id: log_id, device_id: device_id }, { $set: update });
  }

  /** An admin may edit the diary of a device they do not own; nobody else may. */
  private findAccessibleDevice(device_id: string, user_id: string, is_admin: boolean) {
    return this.devices.findOne(is_admin ? { device_id: device_id } : { device_id: device_id, owner_id: user_id }, { device_id: 1 });
  }
}
