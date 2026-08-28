import { z } from 'zod';

/**
 * A grow plan is a list of steps whose fields the webapp owns and keeps adding
 * to, so the steps themselves are passed through unchecked. That it is a list
 * at all is not: the save walks it, and a string walked step by step used to
 * end as a 500 halfway through the write.
 */
const steps = z.array(z.object({}).loose(), { error: 'steps must be a list' });

export const saveRecipeSchema = z.object({
  device_id: z.string({ error: 'device_id must be a string' }),
  // The handler answers its own refusal for a plan that is missing, so an
  // absent or null one has to reach it.
  recipe: z.object({ steps: steps.nullish() }).loose().nullish(),
});

/** The same, for a plan saved as a reusable template. */
export const recipeTemplateSchema = z
  .object({
    name: z.string({ error: 'name must be a string' }).nullish(),
    steps: steps.nullish(),
    public: z.boolean({ error: 'public must be a boolean' }).nullish(),
  })
  .loose();

/**
 * An update that carries nothing at all is how a client says "leave it as it
 * is", and it sends no body to say so - which is not the same as sending one
 * that is wrong.
 */
export const recipeTemplateBody = recipeTemplateSchema.nullish().transform(value => value ?? {});

export type SaveRecipe = z.infer<typeof saveRecipeSchema>;
export type RecipeTemplate = z.infer<typeof recipeTemplateSchema>;
