import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { PlanTemplate, PlanTemplateCreate, PlanTemplateUpdate } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, forbidden, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { StoredPlanTemplate } from '@database/schemas/v1/plan-templates.schema';
import { stepsOf } from './plan-steps';
import { planTemplateOf } from './plan.wire';

/**
 * The plans somebody keeps to start others from.
 *
 * A template is the one thing in this round that `access()` cannot be asked
 * about. Its subjects are the things a grower has - a device, a space, a grow, a
 * plant, a camera, an entry, a picture - and each is decided by the space it
 * stands in, the grow it belongs to and the links onto those. A template stands
 * in no space and belongs to no grow: it is a page in a person's own notebook,
 * like their share links and the grows they follow, and no membership, no share
 * link and no public page reaches one. So the only two facts about it are whose
 * it is and whether its author published it, and they are read here rather than
 * asked of a decision that has nothing to decide.
 *
 * What that costs is stated plainly: a template published by somebody else is
 * readable and copyable by anyone with an account, and changing or deleting one
 * stays with its owner - which is the same shape `access()` gives a public grow,
 * arrived at without inventing an eighth subject for it.
 */
@Injectable()
export class PlanTemplatesService {
  constructor(@InjectModel(MODEL_V1.planTemplate) private readonly templates: Model<StoredPlanTemplate>) {}

  /** Newest first: the list opens on what somebody saved last, the way the share links do. */
  public async list(ctx: AccessContext, query: PageQuery): Promise<CursorPage<PlanTemplate>> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged into one object: the visibility is an `$or`
    // and so is the cursor, and one spread beside the other would replace it -
    // which reads correctly on the first page and hands out every template in
    // the database from the second.
    const conditions: FilterQuery<StoredPlanTemplate>[] = [this.visibleTo(ctx), afterCursor('createdAt', query.cursor)];

    const rows = await this.templates
      .find({ $and: conditions })
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<StoredPlanTemplate[]>()
      .exec();

    const page = pageOf(rows, limit, template => ({ at: template.createdAt, id: template.id }));
    return { items: page.items.map(planTemplateOf), nextCursor: page.nextCursor };
  }

  public async read(ctx: AccessContext, id: string): Promise<PlanTemplate> {
    const template = await this.templates
      .findOne({ $and: [{ id }, this.visibleTo(ctx)] })
      .lean<StoredPlanTemplate>()
      .exec();
    if (!template) throw notFound('plan_template_not_found', 'There is no plan template with that id.');

    return planTemplateOf(template);
  }

  public async create(ctx: AccessContext, body: PlanTemplateCreate): Promise<PlanTemplate> {
    const template: StoredPlanTemplate = {
      id: uuidv4(),
      createdAt: new Date(),
      ownerId: this.accountOf(ctx),
      name: body.name,
      isPublic: body.isPublic,
      steps: stepsOf(body.steps),
    };

    await this.write(() => this.templates.create(template));
    return planTemplateOf(template);
  }

  /** Each field only if it changes, so publishing a template does not ask for its steps back. */
  public async update(ctx: AccessContext, id: string, body: PlanTemplateUpdate): Promise<PlanTemplate> {
    const template = await this.ownedBy(ctx, id);
    const changed: Partial<StoredPlanTemplate> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
      ...(body.steps !== undefined ? { steps: stepsOf(body.steps) } : {}),
    };

    await this.write(() => this.templates.updateOne({ id }, { $set: changed }).exec());
    return planTemplateOf({ ...template, ...changed });
  }

  /**
   * A template is a copy somebody keeps, so deleting one is deleting that copy
   * and nothing else: a plan started from it holds its own steps and carries on
   * with `templateId` naming a template that is gone, which is what that field
   * already says it may do.
   */
  public async remove(ctx: AccessContext, id: string): Promise<void> {
    await this.ownedBy(ctx, id);
    await this.templates.deleteOne({ id }).exec();
  }

  /** The templates a caller may see at all, as one filter rather than a decision per row: their own, and the ones anybody published. */
  private visibleTo(ctx: AccessContext): FilterQuery<StoredPlanTemplate> {
    if (ctx.isAdmin) return {};
    // A demo session is a tour and not an account, so it owns nothing; what it
    // may see is what everybody may see.
    if (ctx.isDemo || ctx.userId === null) return { isPublic: true };

    return { $or: [{ ownerId: ctx.userId }, { isPublic: true }] };
  }

  /**
   * The template as its owner, for the two routes that change one. The refusal
   * is shaped the way `access()` shapes its own: something a caller may read but
   * not change says so, and something they may not even see is simply not there,
   * so a refusal never reports that a template exists to somebody with no
   * business knowing it.
   */
  private async ownedBy(ctx: AccessContext, id: string): Promise<StoredPlanTemplate> {
    const template = await this.templates.findOne({ id }).lean<StoredPlanTemplate>().exec();
    if (!template) throw notFound('plan_template_not_found', 'There is no plan template with that id.');

    if (ctx.isAdmin) return template;
    if (!ctx.isDemo && ctx.userId !== null && template.ownerId === ctx.userId) return template;

    if (template.isPublic) throw forbidden('insufficient_access', 'This plan template may be read but not changed by you.');
    throw notFound('plan_template_not_found', 'There is no plan template with that id.');
  }

  private accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'A plan template belongs to somebody, and this session is nobody.');

    return ctx.userId;
  }

  /** A name is unique to its owner, so the second template called "Autoflower" is refused by the index rather than by a look that could be raced. */
  private async write<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      throw conflict('plan_template_name_taken', 'You already have a plan template with that name.', [
        { field: 'name', code: 'taken', detail: 'A template name is unique to the person who saved it.' },
      ]);
    }
  }
}

/** Mongo says 11000 when a unique index refuses a write; the driver types it as an unknown error. */
const isDuplicateKey = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
