import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { ChartView, ChartViewCreate, ChartViewDefinition, ChartViewSpan, ChartViewUpdate } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageOf, readLimit } from '@common/v1/pages';
import { forbidden, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { ChartViewDocument } from '@database/schemas/v1/chart-views.schema';

type StoredDefinition = ChartViewDocument['definition'];

/**
 * The charts somebody saved to come back to.
 *
 * A view is a page in a person's own notebook: it names devices, a grow, series
 * and a span, but it holds no data and grants no sight of any of them. Opening
 * one asks the series routes for what it names, and each of those decides for
 * itself what the caller may see - so a view that outlives the tent it was drawn
 * for, or is answered for somebody who has since been let go from a space,
 * simply draws less rather than leaking anything.
 *
 * That is also why `access()` is not asked about a view itself. It stands in no
 * space and belongs to no grow; no membership, no share link and no public page
 * reaches one. Whose it is, is the whole of it.
 */
@Injectable()
export class ChartViewsService {
  constructor(@InjectModel(MODEL_V1.chartView) private readonly views: Model<ChartViewDocument>) {}

  /** Newest first: the list opens on what somebody saved last. */
  public async list(ctx: AccessContext, query: PageQuery, limit: number): Promise<CursorPage<ChartView>> {
    const own = this.ownRows(ctx);
    if (!own) return { items: [], nextCursor: null };

    // Combined rather than merged into one object: whose rows these are is one
    // filter and the cursor is another, and spreading one beside the other would
    // silently replace it - which reads correctly on the first page and hands
    // out other people's views from the second.
    const conditions: FilterQuery<ChartViewDocument>[] = [own, afterCursor('createdAt', query.cursor)];

    const rows = await this.views
      .find({ $and: conditions })
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<ChartViewDocument[]>()
      .exec();

    const page = pageOf(rows, limit, view => ({ at: view.createdAt, id: view.id }));
    return { items: page.items.map(chartViewOf), nextCursor: page.nextCursor };
  }

  public async create(ctx: AccessContext, body: ChartViewCreate): Promise<ChartView> {
    const view: ChartViewDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      ownerId: this.accountOf(ctx),
      name: body.name,
      definition: storedDefinition(body.definition),
    };

    await this.views.create(view);
    return chartViewOf(view);
  }

  /** Each field only if it changes, so renaming a view does not ask for what it draws back. */
  public async update(ctx: AccessContext, id: string, body: ChartViewUpdate): Promise<ChartView> {
    const view = await this.ownedBy(ctx, id);
    const changed: Partial<ChartViewDocument> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.definition !== undefined ? { definition: storedDefinition(body.definition) } : {}),
    };

    if (Object.keys(changed).length > 0) await this.views.updateOne({ id }, { $set: changed }).exec();

    return chartViewOf({ ...view, ...changed });
  }

  /** The view is gone. It held nothing but the question, so nothing goes with it. */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    await this.ownedBy(ctx, id);
    await this.views.deleteOne({ id }).exec();
  }

  /**
   * The rows a caller may see at all, as one filter rather than a decision per
   * row, or null where that is none: a demo session is a tour and not an
   * account, so it has no saved views and may save none.
   *
   * An administrator is answered as the person here. This filter is what the
   * listing is held to, and a list of saved charts is somebody's own notebook;
   * an install-wide answer would have filled it with strangers' questions. One
   * view named by id is widened instead, below.
   */
  private ownRows(ctx: AccessContext): FilterQuery<ChartViewDocument> | null {
    if (ctx.isDemo || ctx.userId === null) return null;

    return { ownerId: ctx.userId };
  }

  /**
   * The view as its owner, for the three routes that need one. Somebody else's
   * is answered as missing rather than as refused, because a refusal that named
   * one would report that it exists to a person with no way of knowing that
   * otherwise.
   */
  private async ownedBy(ctx: AccessContext, id: string): Promise<ChartViewDocument> {
    // The office reaches a named view, the way it reaches any other named row;
    // what it does not do is widen the listing, which is the person's own.
    const own = ctx.isAdmin ? {} : this.ownRows(ctx);
    const view =
      own &&
      (await this.views
        .findOne({ $and: [{ id }, own] })
        .lean<ChartViewDocument>()
        .exec());
    if (!view) throw notFound('chart_view_not_found', 'There is no saved chart with that id.');

    return view;
  }

  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'A saved chart belongs to somebody, and this session is nobody.');

    return ctx.userId;
  }
}

/**
 * The span flattened for storage: one path with the field of every arm, of which
 * only its own kind's are filled. Dates become dates here, because that is the
 * one place a fixed span crosses from the wire into the database.
 */
const storedSpan = (span: ChartViewSpan): StoredDefinition['span'] => ({
  kind: span.kind,
  forSeconds: span.kind === 'last' ? span.forSeconds : null,
  range:
    span.kind === 'fixed'
      ? {
          startsAt: span.range.startsAt === null ? null : new Date(span.range.startsAt),
          endsAt: span.range.endsAt === null ? null : new Date(span.range.endsAt),
        }
      : null,
});

const storedDefinition = (definition: ChartViewDefinition): StoredDefinition => ({
  deviceIds: definition.deviceIds,
  growId: definition.growId,
  metrics: definition.metrics,
  outputs: definition.outputs,
  measurements: definition.measurements,
  span: storedSpan(definition.span),
  layout: definition.layout,
  intervalSeconds: definition.intervalSeconds,
});

/**
 * The stored span read back as the union the contract has, with only the fields
 * its kind carries. `storedSpan` is the one writer and always fills the seconds
 * of a rolling span, so the fallback is for a row edited by hand: zero draws
 * nothing and says so, rather than quietly standing for some other span.
 */
const spanOf = (span: StoredDefinition['span']): ChartViewSpan => {
  if (span.kind === 'last') return { kind: 'last', forSeconds: span.forSeconds ?? 0 };
  if (span.kind === 'fixed') {
    return {
      kind: 'fixed',
      range: { startsAt: span.range?.startsAt?.toISOString() ?? null, endsAt: span.range?.endsAt?.toISOString() ?? null },
    };
  }

  return { kind: span.kind };
};

/** The stored document as the contract has it: instants as ISO strings. */
export const chartViewOf = (view: ChartViewDocument): ChartView => ({
  id: view.id,
  createdAt: view.createdAt.toISOString(),
  ownerId: view.ownerId,
  name: view.name,
  definition: {
    deviceIds: view.definition.deviceIds,
    growId: view.definition.growId,
    metrics: view.definition.metrics,
    outputs: view.definition.outputs,
    measurements: view.definition.measurements,
    span: spanOf(view.definition.span),
    layout: view.definition.layout,
    intervalSeconds: view.definition.intervalSeconds,
  },
});
