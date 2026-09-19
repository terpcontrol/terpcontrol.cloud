import { derivedId } from '../ids';
import { LEGACY, LegacyRecipeTemplate, LegacyUser, createdAtOf, flagOf, instantOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { planStep } from './006-plans';

/**
 * The saved plans. The steps are the plan's own steps, so they go through the
 * same transform.
 *
 * Two things the old collection allows that the model does not:
 *
 * - **A template with no owner.** The templates that ship with an install carry
 *   none and are marked public. A public one is given to the oldest
 *   administrator, which keeps exactly today's behaviour - everybody may start
 *   from it, nobody but an operator may edit it - and a private one with no
 *   owner is rejected, because nobody could ever see it.
 * - **A name that is taken.** The old index is unique across every owner, so two
 *   rows with one name exist only where it was never built. The model's index is
 *   per owner; a name that is still taken after that gets a number, so nothing
 *   is lost to a name clash.
 */
export const planTemplates: MigrationStep = {
  name: '009-plan-templates',
  moves: [LEGACY.recipeTemplates],

  async run(context: MigrationContext): Promise<void> {
    const fallbackOwnerId = await oldestAdministrator(context);

    const legacy = await context.source(LEGACY.recipeTemplates);
    const namesPerOwner = new Map<string, Set<string>>();

    for await (const template of legacy.find<LegacyRecipeTemplate>({}).sort({ _id: 1 })) {
      context.count('planTemplates.read');

      const id = derivedId('planTemplate', String(template._id));
      const isPublic = flagOf(template.public);
      const ownerId = textOf(template.owner_id) ?? (isPublic ? fallbackOwnerId : null);

      if (!ownerId) {
        context.reject({
          source: LEGACY.recipeTemplates,
          id: textOf(template.name) ?? String(template._id),
          reason: isPublic
            ? 'no administrator to hand the install’s own template to'
            : 'a template with no owner that is not public is reachable by nobody',
          dropped: true,
          detail: null,
        });
        continue;
      }

      await context.write('planTemplates', {
        id,
        createdAt: instantOf(template.createdAt) ?? createdAtOf(template),
        ownerId,
        name: uniqueName(namesPerOwner, ownerId, textOf(template.name) ?? 'Plan'),
        isPublic,
        steps: (template.steps ?? []).map((step, index) => planStep(context, id, step, index)),
      });
    }
  },
};

const oldestAdministrator = async (context: MigrationContext): Promise<string | null> => {
  const legacy = await context.source(LEGACY.users);
  const admin = await legacy.find<LegacyUser>({ is_admin: true }).sort({ _id: 1 }).limit(1).next();
  return admin ? textOf(admin.user_id) : null;
};

const uniqueName = (taken: Map<string, Set<string>>, ownerId: string, name: string): string => {
  const names = taken.get(ownerId) ?? new Set<string>();
  taken.set(ownerId, names);

  let unique = name;
  for (let suffix = 2; names.has(unique); suffix++) unique = `${name} (${suffix})`;

  names.add(unique);
  return unique;
};
