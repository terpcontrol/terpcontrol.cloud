import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Entry, EntryCreate, EntryUpdate } from '@fg2/shared-types/v1';
import { AccessService, needToEditEntry, subjectRef } from '@common/v1/access.service';
import { AccessContext, Need } from '@common/v1/access.types';
import { serialiseEntry } from '@common/v1/entries';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { badRequest, forbidden, notFound, unauthenticated } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { DEMO_WRITE_MESSAGE } from '@utils/demo';
import { requireLogOn } from './entry-targets';
import { requireMatchingKind, resolveEntryValues } from './entry-values';
import { MAINTENANCE_STARTER, MaintenancePort } from './maintenance.port';

/**
 * The diary, written.
 *
 * Reading it is one route and writing it is one route, for the same reason: a
 * watering, a photo, a measurement and a quarter of an hour in the tent are the
 * same row under a different `kind`, and eight tiles on a sheet should not be
 * eight endpoints. What each kind *means* is `values`, which the contract types
 * per kind; what each kind *does* beyond being written down is here, and only
 * two of them do anything at all.
 *
 * Every line goes out through `EntryWriterService`, so a line a person wrote and
 * a line a device wrote are the same document and the timeline reads as one
 * thing.
 */

/** "In the tent 15 min": the window the tile is labelled with. */
export const VISIT_SECONDS = 15 * 60;

/**
 * How far ahead an entry may be dated. A backdated entry is ordinary - the
 * person is writing down this morning's watering - but a future one would sit at
 * the top of every timeline until the day it named, and the only way it gets
 * written is a mistyped year or a phone whose clock is wrong.
 */
const CLOCK_SKEW_MS = 60_000;

@Injectable()
export class EntryWritesService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly access: AccessService,
    private readonly writer: EntryWriterService,
    @Inject(MAINTENANCE_STARTER) private readonly maintenance: MaintenancePort,
  ) {}

  public async create(ctx: AccessContext, body: EntryCreate): Promise<Entry> {
    requireMatchingKind(body.kind, body.values);

    const authorId = authorOf(ctx);
    const occurredAt = momentOf(body.occurredAt);
    await requireLogOn(this.access, ctx, body);

    const grow = await this.growOf(body.growId ?? null, body.plantIds ?? []);

    const entry = await this.writer.write({
      source: 'human',
      authorId,
      occurredAt,
      growId: grow?.id ?? body.growId ?? null,
      spaceId: body.spaceId ?? null,
      deviceId: body.deviceId ?? null,
      cameraId: body.cameraId ?? null,
      plantIds: body.plantIds ?? [],
      taskId: body.taskId ?? null,
      text: body.text ?? null,
      mediaIds: body.mediaIds ?? [],
      values: resolveEntryValues(body.values, grow, occurredAt),
    });

    if (entry.kind === 'visit') await this.quietenTheTent(entry, grow);

    return serialiseEntry(entry);
  }

  /** One's own, and only what it says: the kind an entry is is what it is, and nothing here writes a second one. */
  public async update(ctx: AccessContext, id: string, body: EntryUpdate): Promise<Entry> {
    const entry = await this.require(id);
    await this.access.require(ctx, subjectRef('entry', id), needToEditEntry(ctx, entry.authorId));

    if (body.values) requireMatchingKind(entry.kind, body.values);

    // What it is about after the edit, which is what has to be writable - moving
    // a line onto somebody else's grow is writing to that grow.
    const targets = {
      growId: body.growId ?? entry.growId,
      spaceId: body.spaceId ?? entry.spaceId,
      deviceId: body.deviceId ?? entry.deviceId,
      cameraId: body.cameraId ?? entry.cameraId,
      plantIds: body.plantIds ?? entry.plantIds,
      mediaIds: body.mediaIds ?? entry.mediaIds,
    };
    await requireLogOn(this.access, ctx, targets);

    const occurredAt = body.occurredAt === undefined ? entry.occurredAt : momentOf(body.occurredAt);
    const grow = await this.growOf(targets.growId, targets.plantIds ?? []);

    const changed: Partial<EntryDocument> = {
      ...(body.growId !== undefined ? { growId: body.growId } : {}),
      ...(body.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
      ...(body.deviceId !== undefined ? { deviceId: body.deviceId } : {}),
      ...(body.cameraId !== undefined ? { cameraId: body.cameraId } : {}),
      ...(body.plantIds !== undefined ? { plantIds: body.plantIds ?? [] } : {}),
      ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.mediaIds !== undefined ? { mediaIds: body.mediaIds ?? [] } : {}),
      ...(body.occurredAt !== undefined ? { occurredAt } : {}),
      ...(body.values ? { values: resolveEntryValues(body.values, grow, occurredAt) } : {}),
    };

    await this.entries.updateOne({ id }, { $set: changed });
    return serialiseEntry({ ...entry, ...changed });
  }

  /**
   * The Undo the sheet draws, and what is left of it afterwards: inside the
   * window an author takes their own line back, and after it a line is removed
   * by whoever manages the place it was written in.
   */
  public async remove(ctx: AccessContext, id: string, now: Date = new Date()): Promise<void> {
    const entry = await this.require(id);
    await this.access.require(ctx, subjectRef('entry', id), this.needToRemove(ctx, entry, now));

    // The pictures are left where they are: the daily sweep removes what nothing
    // points at any more, which is also what makes a picture uploaded and then
    // never attached disappear.
    await this.entries.deleteOne({ id });
  }

  private needToRemove(ctx: AccessContext, entry: EntryDocument, now: Date): Need {
    const stillTheirs = entry.undoUntil !== null && entry.undoUntil.getTime() > now.getTime();

    return stillTheirs ? needToEditEntry(ctx, entry.authorId) : 'manage';
  }

  /**
   * Somebody has their hands in the tent, so the tent stops complaining about
   * what they are doing to it. The window goes on every device standing there,
   * not only on what steers the climate: a plug's thermometer goes off over an
   * open door exactly like the controller's.
   *
   * The entry is already written by the time this runs, and the window is best
   * effort: a device that never hears is what maintenance mode is built to
   * survive, and it is not a reason to refuse the line.
   */
  private async quietenTheTent(entry: EntryDocument, grow: GrowDocument | null): Promise<void> {
    const spaceIds = [
      ...new Set([
        ...(entry.spaceId ? [entry.spaceId] : []),
        ...(grow?.placements ?? []).flatMap(placement => (placement.endedAt === null && placement.spaceId ? [placement.spaceId] : [])),
      ]),
    ];
    if (spaceIds.length === 0) return;

    const here = await this.devices.find({ spaceId: { $in: spaceIds } }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>();
    await Promise.all(here.map(device => this.maintenance.startMaintenance(device.id, VISIT_SECONDS)));
  }

  /** The grow a feed is resolved against: the one named, else the one the plants belong to. */
  private async growOf(growId: string | null, plantIds: string[]): Promise<GrowDocument | null> {
    if (growId) return this.grows.findOne({ id: growId }).lean<GrowDocument>();
    if (plantIds.length === 0) return null;

    const plant = await this.plants.findOne({ id: plantIds[0] }, { growId: 1 }).lean<Pick<PlantDocument, 'growId'>>();
    return plant ? this.grows.findOne({ id: plant.growId }).lean<GrowDocument>() : null;
  }

  private async require(id: string): Promise<EntryDocument> {
    const entry = await this.entries.findOne({ id }).lean<EntryDocument>();
    if (!entry) throw notFound('entry_not_found', 'There is no entry with that id.');

    return entry;
  }
}

/**
 * Every line a person writes carries its author, which is what the undo window
 * and "Mia fed" are read off - so a caller who is nobody in particular cannot
 * write one at all. A share link is exactly such a caller, and it is told what
 * is missing rather than that the grow is not there.
 */
const authorOf = (ctx: AccessContext): string => {
  if (ctx.isDemo) throw forbidden('demo_is_read_only', DEMO_WRITE_MESSAGE);
  if (!ctx.userId) throw unauthenticated('session_required', 'Writing to the diary needs an account: every line carries its author.');

  return ctx.userId;
};

const momentOf = (occurredAt: string | undefined): Date => {
  const at = occurredAt ? new Date(occurredAt) : new Date();

  if (at.getTime() > Date.now() + CLOCK_SKEW_MS) {
    throw badRequest('occurred_in_the_future', 'An entry records something that has happened; it can be backdated but not postdated.', [
      { field: 'occurredAt', code: 'in_the_future', detail: at.toISOString() },
    ]);
  }

  return at;
};
