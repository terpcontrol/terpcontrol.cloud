import type { GrowListItem, HomeAnswer, HomeSpaceCard, Plant } from '@fg2/shared-types/v1';
import { alsoIn } from '@/screens/space/movable-grows';
import type { LogOpening, LogTarget } from './log-context';

/**
 * The chips of the target row: what a line can be about. A grow, and then its
 * plants. A place is a chip only where there are several to tell apart - one
 * per grow growing there, named in it - or where nothing grows in it, so that
 * the line is the place's.
 */

const growTarget = (card: HomeSpaceCard): LogTarget | null =>
  card.grow
    ? {
        key: `grow:${card.grow.growId}`,
        label: card.grow.name,
        growId: card.grow.growId,
        spaceId: null,
        plantIds: [],
        dayNumber: card.grow.dayNumber,
        standsIn: card.spaceId,
      }
    : null;

const spaceTarget = (card: HomeSpaceCard): LogTarget => ({
  key: `space:${card.spaceId}`,
  label: card.name,
  growId: null,
  spaceId: card.spaceId,
  plantIds: [],
  dayNumber: null,
  standsIn: card.spaceId,
});

/** A grow that shares its place with the one the home leads with: the home's card carries the newer alone. */
const twinTarget = (grow: GrowListItem, spaceId: string): LogTarget => ({
  key: `grow:${grow.id}`,
  label: grow.name,
  growId: grow.id,
  spaceId: null,
  plantIds: [],
  dayNumber: grow.summary.dayNumber,
  standsIn: spaceId,
});

/**
 * The targets of the places, in the order the home lists them: each grow growing in a place - the newer first, as
 * Start leads with it - and the space itself where none does. A second grow in a place is a chip of its own, so a
 * line written for it never lands in the other's diary.
 */
export const targetsOf = (home: HomeAnswer | undefined, grows?: GrowListItem[]): LogTarget[] =>
  (home?.spaces ?? []).flatMap(card => {
    const lead = growTarget(card);
    if (!lead) return [spaceTarget(card)];
    const others =
      card.spaceId === null ? [] : alsoIn(grows, card.spaceId, lead.growId!).sort((one, other) => other.startedAt.localeCompare(one.startedAt));
    return [lead, ...others.map(grow => twinTarget(grow, card.spaceId!))];
  });

/**
 * What a place's chip says where several places are chosen between: the place,
 * and the grow growing there - "Zelt · Blue Dream". A grow standing in no
 * place, and a place nothing grows in, is its own name.
 */
export const placeChip = (home: HomeAnswer | undefined, target: LogTarget): string => {
  const card = target.growId && target.standsIn ? (home?.spaces ?? []).find(one => one.spaceId === target.standsIn) : null;
  return card ? `${card.name} · ${target.label}` : target.label;
};

/** The plants of the chosen grow, each a narrower thing the line can be about. */
export const narrowerTargets = (target: LogTarget | null, plants: Plant[]): LogTarget[] =>
  target?.growId
    ? plants
        .filter(plant => plant.status === 'active')
        .map(plant => ({
          key: `plant:${plant.id}`,
          label: plant.label,
          growId: target.growId,
          spaceId: null,
          plantIds: [plant.id],
          dayNumber: target.dayNumber,
          standsIn: target.standsIn,
        }))
    : [];

/** Where a sheet opens, and whether the address it was opened with could be honoured. */
interface Aim {
  /** The chip that starts chosen, or nothing at all where the sheet could not be pointed. */
  target: LogTarget | null;
  /** True where the opening named a grow or a place and none of the chips is it. */
  missed: boolean;
}

/**
 * Which chip starts chosen: the grow or tent the screen underneath is about,
 * then whatever was chosen last time, then the first place where something
 * grows - an empty tent listed first is not where a line is most likely about -,
 * then the first place there is. A sheet opened on the grow page is already
 * pointed at that grow.
 *
 * The fallback is for an opening that named nothing, and for that only. A link
 * that did name a subject and missed is a different answer and not a smaller
 * one: the chips are built from the home, which draws what stands in a place
 * today, so a bookmark or a notification for a grow that has since been
 * harvested - or for a tent this account was let out of - matches none of them.
 * Falling through to the first card there is would hand the sheet a subject
 * nobody asked for while its Save button still writes a line, and the line
 * would land in a running grow's diary under somebody else's name. So the miss
 * is carried out of here as a miss, and the sheet says it and waits.
 */
export const openingTarget = (targets: LogTarget[], opening: LogOpening, last: string | null): Aim => {
  const asked =
    targets.find(target => opening.growId && target.growId === opening.growId) ??
    targets.find(target => opening.spaceId && target.standsIn === opening.spaceId) ??
    null;

  if ((opening.growId || opening.spaceId) && (asked !== null || !opening.underneath)) return { target: asked, missed: asked === null };

  return {
    target: targets.find(target => target.key === last) ?? targets.find(target => target.growId !== null) ?? targets[0] ?? null,
    missed: false,
  };
};
