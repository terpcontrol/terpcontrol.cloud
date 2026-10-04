import type { EntryDose, EntryValues, EntryValuesDraft } from '@fg2/shared-types/v1';
import { dosesFor, schemeWeekOf } from '@fg2/shared-types/v1-schemas';
import { badRequest } from '@common/v1/problem';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { originOf, weekNumberOf } from './grow-calendar';

/**
 * What a person typed, turned into what is stored.
 *
 * Only a feed has anything to work out, and it is worked out here rather than in
 * the entry writer: the writer is the one place a row is written, and what a
 * grow's feeding grid says is not its business.
 *
 * The arithmetic itself is `dosesFor` in the contract package, which is what the
 * feed sheet draws its figures with too - one function, so the line records the
 * numbers the person saw before they tapped.
 */

interface Planned {
  week: number | null;
  doses: EntryDose[];
}

/**
 * The grid read at the week the feed *happened in*, so a feed backdated to last
 * Sunday is resolved at last Sunday's week and not at this one's. A grow with no
 * scheme plans nothing, which is a perfectly ordinary way to feed.
 */
const plannedFeed = (grow: GrowDocument | null, litres: number | null, at: Date): Planned => {
  if (!grow?.scheme) return { week: null, doses: [] };

  const week = weekNumberOf(originOf(grow), at);
  return { week, doses: dosesFor(schemeWeekOf(grow.scheme.grid, week), litres, grow.scheme.strength) };
};

/**
 * What comes out is absolute and complete, and is never read through a grid
 * again: a scheme edited next month leaves every line already written alone.
 */
export const resolveEntryValues = (draft: EntryValuesDraft, grow: GrowDocument | null, occurredAt: Date): EntryValues => {
  switch (draft.kind) {
    case 'water':
      return { kind: 'water', litres: draft.litres ?? null, readings: draft.readings ?? [] };

    case 'feed': {
      const litres = draft.litres ?? null;
      const planned = plannedFeed(grow, litres, occurredAt);

      return {
        kind: 'feed',
        litres,
        schemeWeek: draft.schemeWeek ?? planned.week,
        // What was given is the fact; doses nobody named are what the grid says
        // for that week and that can of water.
        doses: draft.doses ?? planned.doses,
        readings: draft.readings ?? [],
      };
    }

    case 'measurement':
      return { kind: 'measurement', readings: draft.readings ?? [] };

    default:
      return draft;
  }
};

/** An entry states its kind twice, and the pair is checked rather than one of the two believed. */
export const requireMatchingKind = (kind: string, values: { kind: string }): void => {
  if (kind !== values.kind) {
    throw badRequest('kind_mismatch', 'An entry and its values each say what kind it is, and the two have to agree.', [
      { field: 'values.kind', code: 'mismatch', detail: `The entry is a ${kind} and its values are a ${values.kind}.` },
    ]);
  }
};
