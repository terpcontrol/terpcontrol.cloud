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
  'dayShare',
  'verdict',
  'climatePreset',
  'stage',
  'stepPreset',
  'stepSettings',
  'plan',
  'planMoves',
  'dayNight',
  'lightLimit',
  'lightsOn',
  'lightHardStart',
  'resumePlan',
  'growDay',
  'growWeek',
  'autoTag',
  'phasePreset',
  'phaseCorrection',
  'autoflower',
  'growEnds',
  'harvestWeights',
  'dayNightAverages',
  'feedStrength',
  'waterEc',
  'feedFlip',
  'mixing',
  'feedGrid',
  'muteAll',
  'maintenance',
  'presetRules',
  'offlineRule',
  'alarmTemplates',
  'alarmQuiet',
  'alarmFor',
  'alarmRepeat',
  'webhookTemplate',
  'severity',
  'tellBy',
  'routingGrid',
  'emailAlarms',
  'quietHours',
  'tasks',
  'rhythms',
  'rhythmEvery',
  'taskFor',
  'socketRoles',
  'socketAddress',
  'claimCode',
  'claimLater',
  'socketHold',
  'lightHold',
  'firmwareChannel',
  'deviceName',
  'deviceMove',
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
  'streamAddress',
  'streamChange',
  'rolloutFailures',
  'rolloutStages',
  'firmwareClasses',
  'firmwareRegister',
  'adminAddresses',
  'demoObjects',
  'publicPage',
  'linkActions',
  'shareWindow',
  'spaceLink',
  'privacyRedaction',
  'publicProfile',
  'publicGrow',
  'timezone',
  'sessions',
  'accountExport',
  'deleteAccount',
  'passwordChange',
  'installApp',
  'memberRole',
  'removeMember',
  'invite',
  'diaryLayer',
  'follow',
  'compressor',
  'nightBand',
  'ppfd',
  'leafTemperature',
  'lux',
  'climateControl',
  'energySaving',
  'socketTimer',
  'plugMode',
  'plugDayNight',
  'switchPoints',
  'timerWindows',
  'fanMode',
  'fanSpeeds',
  'stepLightHours',
  'readyPlans',
  'drying',
  'germination',
  'germinationAlarm',
  'germinationHumidifier',
] as const;

/**
 * An Erweitert item's own explanation, under `help.advanced.<name>`: an item is
 * added in a file of its own (`ui/advanced/registry.ts`), and its topics come
 * with it rather than being added to the list above. A test holds both
 * catalogues to every such topic the source names.
 */
export type AdvancedHelpTopic = `advanced.${string}`;

export type HelpTopic = (typeof HELP_TOPICS)[number] | AdvancedHelpTopic;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Placement {
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
 * label a word sits in - since those lines are what it explains. A tall block
 * - a card, a whole panel - is not kept clear, because the bubble would then
 * have nowhere to go; the trigger's own line still is. Across, the bubble
 * stays on the trigger, so its arrow points at what was pressed.
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

type Size = { width: number; height: number };

/**
 * Where an explanation stands: above the line it explains when there is room,
 * below it when there is not, and on whichever side has more room when
 * neither is enough. Above first, because a bubble dropped over the field
 * under its label would hide the control it is about. It never overlaps the
 * line it was opened from and is kept inside the window's gutters, its arrow
 * still pointing at the trigger when the bubble has had to slide.
 * One too tall for its side scrolls inside itself, cut between two lines of its text and not through one
 * (`lines`: where the text begins under the bubble's top, and a line's height).
 */
export function placeBubble(anchor: Box, size: Size, view: Size, lines: { top: number; height: number } | null = null): Placement {
  const above = anchor.top - GAP - EDGE_Y;
  const below = view.height - anchor.bottom - GAP - EDGE_Y;
  const side = size.height <= above ? 'above' : size.height <= below ? 'below' : above > below ? 'above' : 'below';
  const most = Math.max(0, side === 'above' ? above : below);
  const room = size.height > most && lines && lines.height > 0 && most > lines.top ? most - ((most - lines.top) % lines.height) : most;
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
