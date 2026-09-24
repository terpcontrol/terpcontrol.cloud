/**
 * Every explanation the app can give, by the name its catalogue block carries:
 * `help.<topic>.title` and `help.<topic>.text` in both languages. One list, so
 * that a term is explained in the same words wherever it is met, and so that a
 * test can hold both catalogues to it - a topic with no German, or a German
 * text nothing opens, fails the build rather than a grower.
 */
export const HELP_TOPICS = [
  'vpd',
  'liveness',
  'band',
  'sortedByAttention',
  'verdict',
  'climatePreset',
  'presetApply',
  'stage',
  'stepPreset',
  'plan',
  'planMoves',
  'dayNight',
  'lightLimit',
  'resumePlan',
  'growDay',
  'growWeek',
  'autoTag',
  'phasePreset',
  'phaseCorrection',
  'autoflower',
  'growEnds',
  'dayNightAverages',
  'feedStrength',
  'waterEc',
  'feedFlip',
  'chartLayout',
  'muteAll',
  'silence',
  'endMaintenance',
  'presetRules',
  'offlineRule',
  'severity',
  'tellBy',
  'routingGrid',
  'quietHours',
  'rhythms',
  'rhythmEvery',
  'taskFor',
  'socketRoles',
  'socketHold',
  'findSocket',
  'lightHold',
  'firmwareChannel',
  'stillCadence',
  'cameraPauses',
  'staleWarning',
  'premiumCamera',
  'timelapses',
  'overlays',
  'lightsOffFrames',
  'render',
  'unpair',
  'rtsp',
  'rolloutFailures',
  'publicPage',
  'linkActions',
  'shareWindow',
  'spaceLink',
  'privacyRedaction',
  'publicProfile',
  'deleteAccount',
  'passwordChange',
  'memberRole',
  'invite',
  'follow',
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  top: number;
  left: number;
  side: 'above' | 'below';
  /** Where the arrow meets the bubble's edge, from the bubble's left. */
  arrow: number;
  /** The room on the chosen side; a bubble taller than that scrolls. */
  room: number;
}

/**
 * What a bubble must keep clear of: the trigger itself, and the block it
 * stands in as long as that block is short - the sentence an (i) ends, the
 * label a word sits in, the row of buttons it follows. An (i) at the end of a
 * three-line sentence would otherwise open over the first two lines, which
 * are what it explains. A tall block - a card, a whole panel - is not kept
 * clear, because the bubble would then have nowhere to go; the trigger's own
 * line still is. Across, the bubble stays on the trigger, so its arrow points
 * at what was pressed.
 */
export function anchorOf(trigger: Box, block: Box | null): Box {
  // Read field by field: a DOMRect keeps its sides on its prototype, so spreading one copies nothing.
  const { top, bottom, left, right } = trigger;
  if (!block || block.bottom - block.top > TALLEST_BLOCK) return { top, bottom, left, right };

  return { top: Math.min(top, block.top), bottom: Math.max(bottom, block.bottom), left, right };
}

/** Taller than this, a block is the page rather than the line, and only the trigger is kept clear. */
const TALLEST_BLOCK = 240;

/** Between the thing explained and the bubble. */
const GAP = 8;
/** Kept clear at the window's top and bottom. */
const EDGE_Y = 8;
/** Kept clear at the sides: a phone's gutter. */
const EDGE_X = 16;
/** How near the bubble's corner the arrow may come before it leaves the curve. */
const ARROW_INSET = 14;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where an explanation stands: above the line it explains when there is room
 * for it there, below it when there is not, and on whichever side has more
 * room when neither is enough. Above first, because what a word or a heading
 * explains is that line and what follows it - a bubble dropped over the field
 * under its label would hide the very control it is about, and on a phone
 * there is no second column for it to move into. It never overlaps the line
 * it was opened from, and it is kept inside the window's gutters, with its
 * arrow still pointing at the trigger when the bubble has had to slide.
 */
export function placeBubble(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }): Placement {
  const above = anchor.top - GAP - EDGE_Y;
  const below = view.height - anchor.bottom - GAP - EDGE_Y;
  const side = size.height <= above ? 'above' : size.height <= below ? 'below' : above > below ? 'above' : 'below';
  const room = Math.max(0, side === 'above' ? above : below);
  const height = Math.min(size.height, room);
  const centre = (anchor.left + anchor.right) / 2;
  const left = clamp(centre - size.width / 2, EDGE_X, view.width - EDGE_X - size.width);

  return {
    top: side === 'above' ? anchor.top - GAP - height : anchor.bottom + GAP,
    left,
    side,
    arrow: clamp(centre - left, ARROW_INSET, size.width - ARROW_INSET),
    room,
  };
}
