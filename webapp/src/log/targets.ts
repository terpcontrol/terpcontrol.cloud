import type { HomeAnswer, HomeSpaceCard, Plant } from '@fg2/shared-types/v1';
import type { LogOpening, LogTarget } from './log-context';

/**
 * The chips of the target row: every place a line can go, and then the narrower
 * places inside the one that is chosen.
 *
 * A grow and the space it stands in are both first-class - a tent is logged
 * against when nothing grows in it, and a grow is logged against wherever it
 * stands - so the row is not a hierarchy to walk down but a list to pick from.
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

/** One chip per place, in the order the home lists them: its grow where one grows, the space itself where none does. */
export const targetsOf = (home: HomeAnswer | undefined): LogTarget[] => (home?.spaces ?? []).map(card => growTarget(card) ?? spaceTarget(card));

/** The card the chosen target belongs to, which is where its tent and its own name are. A grow that stands nowhere has none. */
const cardOf = (home: HomeAnswer | undefined, target: LogTarget | null): HomeSpaceCard | null =>
  target?.standsIn ? ((home?.spaces ?? []).find(card => card.spaceId === target.standsIn) ?? null) : null;

/** The tent the chosen grow stands in and its plants: the rest of the board's row, and only while a grow is chosen. */
export const narrowerTargets = (home: HomeAnswer | undefined, target: LogTarget | null, plants: Plant[]): LogTarget[] => {
  if (!target?.growId) return [];

  const card = cardOf(home, target);
  const growing = plants.filter(plant => plant.status === 'active');

  return [
    ...(card ? [spaceTarget(card)] : []),
    ...growing.map(plant => ({
      key: `plant:${plant.id}`,
      label: plant.label,
      growId: target.growId,
      spaceId: null,
      plantIds: [plant.id],
      dayNumber: target.dayNumber,
      standsIn: target.standsIn,
    })),
  ];
};

/** Where a sheet opens, and whether the address it was opened with could be honoured. */
export interface Aim {
  /** The chip that starts chosen, or nothing at all where the sheet could not be pointed. */
  target: LogTarget | null;
  /** True where the opening named a grow or a place and none of the chips is it. */
  missed: boolean;
}

/**
 * Which chip starts chosen: the grow or tent the screen underneath is about,
 * then whatever was chosen last time, then the first place there is. A sheet
 * opened on the grow page is already pointed at that grow.
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

  return { target: targets.find(target => target.key === last) ?? targets[0] ?? null, missed: false };
};
