import { type AdvancedContexts, type AdvancedItem, type AdvancedScope, type ItemOf } from './item';

/**
 * Every Erweitert item there is: each module under `src/` whose name ends in
 * `.advanced.tsx`, found at build time (see `item.ts`). Read on first use
 * rather than as this module loads, because an item's own imports reach back
 * here through the section it is drawn in.
 */
const modules = import.meta.glob<{ items: AdvancedItem[] }>('/src/**/*.advanced.tsx', { eager: true });

let found: AdvancedItem[] | null = null;

const everyItem = (): AdvancedItem[] => (found ??= Object.values(modules).flatMap(module => module.items));

/** The items a section offers for this context, in their order. */
export const itemsFor = <S extends AdvancedScope>(scope: S, context: AdvancedContexts[S], from: readonly AdvancedItem[] = everyItem()): ItemOf<S>[] =>
  (from.filter(item => item.scope === scope) as unknown as ItemOf<S>[])
    .filter(item => item.shows(context))
    .sort((one, other) => one.order - other.order || one.id.localeCompare(other.id));
