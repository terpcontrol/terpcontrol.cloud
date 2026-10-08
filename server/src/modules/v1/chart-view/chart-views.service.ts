import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { ChartView, ChartViewCreate, ChartViewDefinition, ChartViewSpan, ChartViewUpdate } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { ownRows, requireOwned } from '@common/v1/owned-rows';
import { CursorPage, findPage, mapPage } from '@common/v1/pages';
import { notFound } from '@common/v1/problem';
import { dateRange, isoRange } from '@common/v1/range';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { ChartViewDocument } from '@database/schemas/v1/chart-views.schema';
import { accountOf } from '../caller';

type StoredDefinition = ChartViewDocument['definition'];

const missing = () => notFound('chart_view_not_found', 'There is no saved chart with that id.');

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
  public async list(ctx: AccessContext, query: PageQuery): Promise<CursorPage<ChartView>> {
    const own = ownRows(ctx);
    if (!own) return { items: [], nextCursor: null };

    return mapPage(await findPage(this.views, [own], query), chartViewOf);
  }

  public async create(ctx: AccessContext, body: ChartViewCreate): Promise<ChartView> {
    const view: ChartViewDocument = {
      id: uuidv4(),
      createdAt: new Date(),
      ownerId: accountOf(ctx, 'A saved chart belongs to somebody, and this session is nobody.'),
      name: body.name,
      definition: storedDefinition(body.definition),
    };

    await this.views.create(view);
    return chartViewOf(view);
  }

  /** Each field only if it changes, so renaming a view does not ask for what it draws back. */
  public async update(ctx: AccessContext, id: string, body: ChartViewUpdate): Promise<ChartView> {
    const view = await requireOwned(this.views, ctx, id, missing);
    const changed: Partial<ChartViewDocument> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.definition !== undefined ? { definition: storedDefinition(body.definition) } : {}),
    };

    if (Object.keys(changed).length > 0) await this.views.updateOne({ id }, { $set: changed }).exec();

    return chartViewOf({ ...view, ...changed });
  }

  /** The view is gone. It held nothing but the question, so nothing goes with it. */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    await requireOwned(this.views, ctx, id, missing);
    await this.views.deleteOne({ id }).exec();
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
  range: span.kind === 'fixed' ? dateRange(span.range) : null,
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
    return { kind: 'fixed', range: isoRange(span.range ?? { startsAt: null, endsAt: null }) };
  }

  return { kind: span.kind };
};

/** The stored document as the contract has it: instants as ISO strings. */
const chartViewOf = (view: ChartViewDocument): ChartView => ({
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
