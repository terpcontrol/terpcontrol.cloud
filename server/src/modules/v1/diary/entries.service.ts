import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import type { EntryKind, EntryPage } from '@fg2/shared-types/v1';
import { entryKind } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, SubjectRef, SubjectType } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { badRequest } from '@common/v1/problem';
import { clampRange, withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowsService } from '../grow/grows.service';
import { serialiseDiaryEntry } from './diary-entries';

/**
 * The timeline, read.
 *
 * One list, whatever it is about: a grow's diary, a tent's, one device's log and
 * one plant's history are the same rows asked for by a different scope, so the
 * screens that show them are one read with one shape.
 *
 * A scope is required rather than defaulted. "Every entry this account can see"
 * is not a screen anybody drew, and answering it would mean deciding access per
 * row instead of once - which is how a list starts handing out what a second
 * page may not see.
 */

/** What a timeline can be about. In the order a refusal names them. */
const SCOPES: readonly SubjectType[] = ['grow', 'space', 'device', 'plant'];

export interface EntryListQuery {
  growId?: string;
  spaceId?: string;
  deviceId?: string;
  plantId?: string;
  startsAt?: string;
  endsAt?: string;
  kinds?: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class EntriesService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly access: AccessService,
    private readonly grows: GrowsService,
  ) {}

  public async list(ctx: AccessContext, query: EntryListQuery): Promise<EntryPage> {
    const scope = scopeOf(query);
    const grant = await this.access.require(ctx, scope, 'view');
    const hide = await this.grows.redaction(grant);

    const range = clampRange(grant, { startsAt: instantOf(query.startsAt), endsAt: instantOf(query.endsAt) });
    const limit = pageLimit(query.limit);

    // Combined rather than merged into one object: the scope of a space and the
    // cursor are each an `$or` of their own, and one would silently replace the
    // other - which would hand out entries of other people's tents from the
    // second page on, while the first page looked right.
    const conditions: FilterQuery<EntryDocument>[] = [
      await this.about(scope),
      withinRange('occurredAt', range),
      kindsOf(query.kinds),
      afterCursor('occurredAt', query.cursor),
    ];

    const rows = await this.entries.find({ $and: conditions }).sort({ occurredAt: -1, id: -1 }).limit(readLimit(limit)).lean<EntryDocument[]>();

    const page: CursorPage<EntryDocument> = pageOf(rows, limit, row => ({ at: row.occurredAt, id: row.id }));

    return {
      items: page.items.map(row => serialiseDiaryEntry(row, hide, grant.includeCameras)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Which rows the scope names. A space takes in the lines of the devices
   * standing in it as well as its own, because a tent's timeline is what
   * happened in the tent and a controller's boot message happened in the tent.
   */
  private async about(scope: SubjectRef): Promise<FilterQuery<EntryDocument>> {
    switch (scope.type) {
      case 'grow':
        return { growId: scope.id };
      case 'device':
        return { deviceId: scope.id };
      case 'plant':
        return { plantIds: scope.id };
      default: {
        const here = await this.devices.find({ spaceId: scope.id }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>();
        return { $or: [{ spaceId: scope.id }, { deviceId: { $in: here.map(device => device.id) } }] };
      }
    }
  }
}

/** Exactly one, so that the decision is made once about one thing rather than per row. */
const scopeOf = (query: EntryListQuery): SubjectRef => {
  const named = SCOPES.flatMap(type => {
    const id = query[`${type}Id` as 'growId' | 'spaceId' | 'deviceId' | 'plantId'];
    return id ? [subjectRef(type, id)] : [];
  });

  if (named.length !== 1) {
    throw badRequest('one_scope_required', 'A timeline is about exactly one grow, space, device or plant.', [
      { field: 'growId', code: named.length === 0 ? 'required' : 'exclusive', detail: 'Name one of growId, spaceId, deviceId or plantId.' },
    ]);
  }

  return named[0];
};

const kindsOf = (kinds: string | undefined): FilterQuery<EntryDocument> => {
  if (!kinds) return {};

  const named = kinds
    .split(',')
    .map(kind => kind.trim())
    .filter(Boolean);
  const strangers = named.filter(kind => !(entryKind.options as readonly string[]).includes(kind));

  if (named.length === 0 || strangers.length > 0) {
    throw badRequest('unknown_entry_kind', 'A timeline is filtered by the kinds an entry can be.', [
      { field: 'kinds', code: 'unknown', detail: strangers.join(', ') || 'Name at least one kind.' },
    ]);
  }

  return { kind: { $in: named as EntryKind[] } };
};

/** The query schema has already said it is an instant; this is only the boundary where the wire's string becomes one. */
const instantOf = (value: string | undefined): Date | undefined => (value ? new Date(value) : undefined);
