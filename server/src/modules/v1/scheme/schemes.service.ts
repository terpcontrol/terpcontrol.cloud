import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { Scheme, SchemeCreate, SchemeUpdate } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageOf, readLimit } from '@common/v1/pages';
import { forbidden, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { SchemeDocument } from '@database/schemas/v1/schemes.schema';

/**
 * The feeding schemes somebody keeps of their own: one they wrote from nothing,
 * and one they took from a manufacturer's shipped chart and changed.
 *
 * The manufacturers' schemes are JSON assets in the client and this server never
 * reads one, so what a row here holds is only ever a person's own work. `origin`
 * is what the client says about where it started - which asset, at which version
 * of it - and is a note rather than a link: nothing on this side resolves it,
 * and an asset that ships differently next year does not change what was saved.
 *
 * A grow keeps its own copy of the grid, so none of this reaches back into one.
 * Editing a scheme here changes what the next grow starts from and leaves every
 * grow already running exactly as it was, which is what keeps a diary's feeding
 * history true to what was actually poured.
 *
 * Like a plan template, a scheme is one of the few things `access()` cannot be
 * asked about: it stands in no space, belongs to no grow, and no membership, no
 * share link and no public page reaches one. Whose it is, is the whole of it.
 */
@Injectable()
export class SchemesService {
  constructor(@InjectModel(MODEL_V1.scheme) private readonly schemes: Model<SchemeDocument>) {}

  /** Newest first: the list opens on what somebody saved last. */
  public async list(ctx: AccessContext, query: PageQuery, limit: number): Promise<CursorPage<Scheme>> {
    const own = this.ownRows(ctx);
    if (!own) return { items: [], nextCursor: null };

    // Combined rather than merged into one object: whose rows these are is one
    // filter and the cursor is another, and spreading one beside the other would
    // silently replace it - which reads correctly on the first page and hands
    // out other people's schemes from the second.
    const conditions: FilterQuery<SchemeDocument>[] = [own, afterCursor('createdAt', query.cursor)];

    const rows = await this.schemes
      .find({ $and: conditions })
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<SchemeDocument[]>()
      .exec();

    const page = pageOf(rows, limit, scheme => ({ at: scheme.createdAt, id: scheme.id }));
    return { items: page.items.map(schemeOf), nextCursor: page.nextCursor };
  }

  public async create(ctx: AccessContext, body: SchemeCreate): Promise<Scheme> {
    const scheme: SchemeDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      ownerId: this.accountOf(ctx),
      name: body.name,
      origin: { assetId: body.origin?.assetId ?? null, version: body.origin?.version ?? null },
      grid: body.grid,
    };

    await this.schemes.create(scheme);
    return schemeOf(scheme);
  }

  /**
   * Each field only if it changes, so renaming a scheme does not ask for its
   * whole grid back - and a grid saved in one request is saved whole, because a
   * week that has gone from the table is a week that is no longer fed.
   */
  public async update(ctx: AccessContext, id: string, body: SchemeUpdate): Promise<Scheme> {
    const scheme = await this.ownedBy(ctx, id);
    const changed: Partial<SchemeDocument> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.origin !== undefined ? { origin: { assetId: body.origin.assetId, version: body.origin.version } } : {}),
      ...(body.grid !== undefined ? { grid: body.grid } : {}),
    };

    if (Object.keys(changed).length > 0) await this.schemes.updateOne({ id }, { $set: changed }).exec();

    return schemeOf({ ...scheme, ...changed });
  }

  /**
   * The scheme is gone and nothing else is. A grow started from it carries its
   * own grid and goes on being fed the same way, which is the same promise that
   * lets this one be edited at all.
   */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    await this.ownedBy(ctx, id);
    await this.schemes.deleteOne({ id }).exec();
  }

  /**
   * The rows a caller may see at all, as one filter rather than a decision per
   * row, or null where that is none: a demo session is a tour and not an
   * account, so it owns nothing, and nothing here is anybody's but its owner's.
   */
  private ownRows(ctx: AccessContext): FilterQuery<SchemeDocument> | null {
    if (ctx.isAdmin) return {};
    if (ctx.isDemo || ctx.userId === null) return null;

    return { ownerId: ctx.userId };
  }

  /**
   * The scheme as its owner, for the three routes that need one. Somebody
   * else's is answered as missing rather than as refused: a scheme is nobody's
   * business but its owner's, so a refusal that named one would report that it
   * exists to a person with no way of knowing that otherwise.
   */
  private async ownedBy(ctx: AccessContext, id: string): Promise<SchemeDocument> {
    const own = this.ownRows(ctx);
    const scheme =
      own &&
      (await this.schemes
        .findOne({ $and: [{ id }, own] })
        .lean<SchemeDocument>()
        .exec());
    if (!scheme) throw notFound('scheme_not_found', 'There is no feeding scheme with that id.');

    return scheme;
  }

  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'A feeding scheme belongs to somebody, and this session is nobody.');

    return ctx.userId;
  }
}

/** The stored document as the contract has it: instants as ISO strings. */
export const schemeOf = (scheme: SchemeDocument): Scheme => ({
  id: scheme.id,
  createdAt: scheme.createdAt.toISOString(),
  ownerId: scheme.ownerId,
  name: scheme.name,
  origin: { assetId: scheme.origin?.assetId ?? null, version: scheme.origin?.version ?? null },
  grid: scheme.grid.map(week => ({
    week: week.week,
    stage: week.stage,
    amounts: week.amounts.map(amount => ({ productKey: amount.productKey, name: amount.name, value: amount.value, unit: amount.unit })),
  })),
});
