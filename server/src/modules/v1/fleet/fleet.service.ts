import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  DeviceClass,
  DeviceClassCreate,
  DeviceClassUpdate,
  Firmware,
  FirmwareCreate,
  FirmwareUpdate,
  Fleet,
  FleetClass,
  FleetFirmwareStats,
} from '@fg2/shared-types/v1';
import { BackgroundWork } from '@common/background-work';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound } from '@common/v1/problem';
import { onlineSince } from '@common/v1/value-age';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { StoredDeviceClass } from '@database/schemas/v1/device-classes.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredFirmware } from '@database/schemas/v1/firmwares.schema';
import { StoredFirmwareBinary } from '@database/schemas/v1/firmware-binaries.schema';
import { logger } from '@utils/logger';
import { UPGRADE_TIMEOUT_MS } from './firmware-rollout.service';

/**
 * The builds this cloud hands out and the classes they are handed out to.
 *
 * A class is the update unit: a device belongs to one, a channel of the class
 * names the build that channel's devices should be running, and the rollout
 * reads nothing else to decide what to send. The bytes of a build live in
 * `firmwareBinaries` and are streamed by the device protocol; nothing here ever
 * loads one.
 */

/**
 * The hardware types this cloud knows. A device names its type when it
 * registers, and a type with no class is a device that cannot be enrolled at
 * all - so they are seeded rather than created by hand, which is what makes a
 * fresh install one a device can register with.
 *
 * No channel points anywhere until a build is rolled out, so a seeded class
 * hands out nothing. They are never updated afterwards: how fast a class is
 * rolled out is an operator's decision once it has been made.
 */
const SEEDED_CLASSES: readonly { name: string; description: string }[] = [
  { name: 'fridge', description: 'Fridge Controller' },
  { name: 'fan', description: 'Fan Controller' },
  { name: 'light', description: 'Light Controller' },
  { name: 'plug', description: 'Smart Socket' },
  { name: 'controller', description: 'FG Controller 2.0' },
];

/** What a seeded class starts with: as many devices updating at once, and the failures that stop it. */
const SEEDED_CONCURRENT_UPDATES = 5;
const SEEDED_MAX_FAILURES = 10;

@Injectable()
export class FleetService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.deviceClass) private readonly classes: Model<StoredDeviceClass>,
    @InjectModel(MODEL_V1.firmware) private readonly firmwares: Model<StoredFirmware>,
    @InjectModel(MODEL_V1.firmwareBinary) private readonly binaries: Model<StoredFirmwareBinary>,
  ) {}

  public onModuleInit(): void {
    this.work.run('Creating the device classes', () => this.seedClasses());
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  // ---------------------------------------------------------------- classes

  private async seedClasses(): Promise<void> {
    for (const seeded of SEEDED_CLASSES) {
      if (await this.classes.exists({ name: seeded.name })) continue;

      logger.info(`Creating the device class ${seeded.name}`);
      await this.classes.create({
        id: uuidv4(),
        createdAt: new Date(),
        name: seeded.name,
        description: seeded.description,
        concurrentUpdates: SEEDED_CONCURRENT_UPDATES,
        maxFailures: SEEDED_MAX_FAILURES,
        firmwareIds: { stable: null, beta: null, alpha: null },
        rollout: { paused: false, percent: 100 },
      });
    }
  }

  public async listClasses(query: PageQuery): Promise<CursorPage<DeviceClass>> {
    const limit = pageLimit(query.limit);
    const rows = await this.classes
      .find(afterCursor('createdAt', query.cursor))
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<StoredDeviceClass[]>();

    const page = pageOf(rows, limit, row => ({ at: row.createdAt, id: row.id }));
    return { items: page.items.map(serialiseClass), nextCursor: page.nextCursor };
  }

  public async requireClass(id: string): Promise<StoredDeviceClass> {
    const deviceClass = await this.classes.findOne({ id }).lean<StoredDeviceClass>();
    if (!deviceClass) throw notFound('device_class_not_found', 'There is no device class with that id.');

    return deviceClass;
  }

  /**
   * A class is named after the hardware type a device reports when it registers,
   * so two of a name would make the registration ambiguous.
   */
  public async createClass(body: DeviceClassCreate): Promise<DeviceClass> {
    if (await this.classes.exists({ name: body.name })) {
      throw conflict('device_class_exists', 'A device class of that name already exists.');
    }

    const deviceClass: StoredDeviceClass = { ...body, id: uuidv4(), createdAt: new Date() };
    await this.classes.create(deviceClass);

    return serialiseClass(deviceClass);
  }

  public async updateClass(id: string, body: DeviceClassUpdate): Promise<DeviceClass> {
    await this.requireClass(id);
    if (body.name && (await this.classes.exists({ name: body.name, id: { $ne: id } }))) {
      throw conflict('device_class_exists', 'A device class of that name already exists.');
    }

    const changed = await this.classes.findOneAndUpdate({ id }, { $set: defined(body) }, { new: true }).lean<StoredDeviceClass>();
    if (!changed) throw notFound('device_class_not_found', 'There is no device class with that id.');

    // A build that has been on a class's stable channel can be rolled back to
    // knowingly, which is the one thing `wasStable` records.
    if (changed.firmwareIds.stable) await this.firmwares.updateOne({ id: changed.firmwareIds.stable }, { $set: { wasStable: true } });

    return serialiseClass(changed);
  }

  // -------------------------------------------------------------- firmwares

  public async listFirmwares(query: PageQuery, classId?: string): Promise<CursorPage<Firmware>> {
    if (classId) await this.requireClass(classId);

    const limit = pageLimit(query.limit);
    const rows = await this.firmwares
      .find({ ...(classId ? { classId } : {}), ...afterCursor('createdAt', query.cursor) })
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<StoredFirmware[]>();

    const page = pageOf(rows, limit, row => ({ at: row.createdAt, id: row.id }));
    return { items: page.items.map(serialiseFirmware), nextCursor: page.nextCursor };
  }

  public async requireFirmware(id: string): Promise<StoredFirmware> {
    const firmware = await this.firmwares.findOne({ id }).lean<StoredFirmware>();
    if (!firmware) throw notFound('firmware_not_found', 'There is no firmware build with that id.');

    return firmware;
  }

  public async createFirmware(body: FirmwareCreate): Promise<Firmware> {
    await this.requireClass(body.classId);

    const firmware: StoredFirmware = { ...body, id: uuidv4(), createdAt: new Date(), wasStable: false };
    await this.firmwares.create(firmware);

    return serialiseFirmware(firmware);
  }

  public async updateFirmware(id: string, body: FirmwareUpdate): Promise<Firmware> {
    if (body.classId) await this.requireClass(body.classId);

    const changed = await this.firmwares.findOneAndUpdate({ id }, { $set: defined(body) }, { new: true }).lean<StoredFirmware>();
    if (!changed) throw notFound('firmware_not_found', 'There is no firmware build with that id.');

    return serialiseFirmware(changed);
  }

  /**
   * A build a channel still points at is not deleted: the devices on that
   * channel would go on being told to install something whose bytes are gone,
   * and OTA would fail for as long as it took somebody to notice.
   */
  public async removeFirmware(id: string): Promise<void> {
    await this.requireFirmware(id);

    const pointedAt = await this.classes.exists({
      $or: [{ 'firmwareIds.stable': id }, { 'firmwareIds.beta': id }, { 'firmwareIds.alpha': id }],
    });
    if (pointedAt) throw conflict('firmware_in_use', 'A channel of a device class still points at this build. Point it elsewhere first.');

    await this.binaries.deleteMany({ firmwareId: id });
    await this.firmwares.deleteOne({ id });
  }

  /** One file of a build, by the name the device asks for it under. Uploading it again replaces it. */
  public async storeBinary(firmwareId: string, name: string, data: Buffer): Promise<void> {
    await this.requireFirmware(firmwareId);

    await this.binaries.updateOne({ firmwareId, name }, { $set: { data }, $setOnInsert: { id: uuidv4(), createdAt: new Date() } }, { upsert: true });
  }

  // ------------------------------------------------------------------ fleet

  /**
   * What the fleet is running, class by class. Not a page: there are as many
   * rows as there are device classes, and a rollout is staged with all of them
   * in front of you.
   */
  public async fleet(now: Date = new Date()): Promise<Fleet> {
    const classes = await this.classes.find().sort({ name: 1 }).lean<StoredDeviceClass[]>();
    const known = classes.map(row => row.id);

    return {
      classes: await Promise.all(classes.map(row => this.fleetClass(row, now))),
      unclassifiedDevices: await this.devices.countDocuments({ $or: [{ classId: null }, { classId: { $nin: known } }] }),
    };
  }

  private async fleetClass(deviceClass: StoredDeviceClass, now: Date): Promise<FleetClass> {
    const builds = await this.firmwares.find({ classId: deviceClass.id }).sort({ createdAt: -1 }).lean<StoredFirmware[]>();
    const known = builds.map(build => build.id);

    const stats = await Promise.all(builds.map(build => this.firmwareStats(deviceClass.id, build, now)));
    // Devices running something this server has no record of, which is what a
    // build flashed over USB reports. One row, with no build to name.
    stats.push({
      firmwareId: null,
      version: 'unknown',
      name: null,
      total: await this.devices.countDocuments({ classId: deviceClass.id, 'state.firmwareId': { $nin: known } }),
      online: await this.devices.countDocuments({
        classId: deviceClass.id,
        'state.firmwareId': { $nin: known },
        'state.lastSeenAt': { $gte: onlineSince(now) },
      }),
      updating: 0,
      failed: 0,
      averageUpdateMs: null,
      maxUpdateMs: null,
    });

    return {
      classId: deviceClass.id,
      name: deviceClass.name,
      total: await this.devices.countDocuments({ classId: deviceClass.id }),
      online: await this.devices.countDocuments({ classId: deviceClass.id, 'state.lastSeenAt': { $gte: onlineSince(now) } }),
      rollout: deviceClass.rollout,
      firmwares: stats,
    };
  }

  private async firmwareStats(classId: string, build: StoredFirmware, now: Date): Promise<FleetFirmwareStats> {
    const running = { classId, 'state.firmwareId': build.id };
    // Told to install this build and not yet reporting it: still going inside
    // the window, given up afterwards.
    const partway = { classId, 'firmware.targetId': build.id, 'state.firmwareId': { $ne: build.id } };
    const deadline = new Date(now.getTime() - UPGRADE_TIMEOUT_MS);

    const [durations] = await this.devices.aggregate<{ average: number; longest: number }>([
      { $match: { 'state.firmwareId': build.id, 'state.updateStartedAt': { $ne: null }, 'state.updateEndedAt': { $ne: null } } },
      {
        $group: {
          _id: null,
          average: { $avg: { $subtract: ['$state.updateEndedAt', '$state.updateStartedAt'] } },
          longest: { $max: { $subtract: ['$state.updateEndedAt', '$state.updateStartedAt'] } },
        },
      },
    ]);

    return {
      firmwareId: build.id,
      version: build.version,
      name: build.name,
      total: await this.devices.countDocuments(running),
      online: await this.devices.countDocuments({ ...running, 'state.lastSeenAt': { $gte: onlineSince(now) } }),
      updating: await this.devices.countDocuments({ ...partway, 'state.updateStartedAt': { $gte: deadline } }),
      failed: await this.devices.countDocuments({ ...partway, 'state.updateStartedAt': { $lt: deadline } }),
      averageUpdateMs: durations ? Math.round(durations.average) : null,
      maxUpdateMs: durations ? Math.round(durations.longest) : null,
    };
  }
}

/** A patch carries only what it changes, and `undefined` is "not mentioned" rather than a value. */
const defined = <T extends object>(body: T): Partial<T> => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Field by field, because `_id` rides along on a lean document and never leaves the server. */
export const serialiseClass = (row: StoredDeviceClass): DeviceClass => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  name: row.name,
  description: row.description,
  concurrentUpdates: row.concurrentUpdates,
  maxFailures: row.maxFailures,
  firmwareIds: { stable: row.firmwareIds.stable, beta: row.firmwareIds.beta, alpha: row.firmwareIds.alpha },
  rollout: { paused: row.rollout.paused, percent: row.rollout.percent },
});

export const serialiseFirmware = (row: StoredFirmware): Firmware => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  classId: row.classId,
  name: row.name,
  version: row.version,
  wasStable: row.wasStable,
});
