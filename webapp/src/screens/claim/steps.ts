import type { Device, GrowthStage, PresetApplication, SocketPage, Space } from '@fg2/shared-types/v1';

/**
 * What each step of the claim flow has settled, and the one line it says once
 * it is closed.
 *
 * A step is only rendered while it is open, so what it decided cannot live in
 * it: the screen holds the answers and these put them into the sentence the
 * ticked step carries. They are here rather than beside the steps because that
 * is the one thing the four have in common.
 */

/** Monitoring only: the place is watched and charted, and nothing is written to the controller. */
export const MEASURE = 'measure';

export interface Doing {
  chosen: GrowthStage | typeof MEASURE | null;
  applied: PresetApplication | null;
}

export const NOTHING_DOING: Doing = { chosen: null, applied: null };

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What to call the place a claim has just made.
 *
 * A place is named after what it is and in the language the grower reads, so
 * the word comes out of the catalogue by the type of hardware standing in it
 * rather than being the type key itself - a home whose first card says
 * "controller" names a part and not a place, and says it in English whatever
 * the account is set to. The number is the first one none of their places
 * carries, so claiming a second controller gives "Tent 2" rather than a second
 * "Tent 1".
 */
export const newPlaceName = (type: string, spaces: readonly Space[], t: Translate): string => {
  const taken = new Set(spaces.map(one => one.name.trim().toLowerCase()));
  let name = '';

  for (let n = 1; n <= spaces.length + 1; n += 1) {
    name = t(`claim.place.newName.${type}`, { n, defaultValue: t('claim.place.newName.other', { n }) });
    if (!taken.has(name.toLowerCase())) break;
  }

  return name;
};

/** The place, and what kind of place it is. */
export const placeSummary = (space: Space | null, t: Translate): string =>
  space ? `${space.name} · ${t(`claim.place.kind.${space.kind}`, { defaultValue: space.kind })}` : t('claim.place.unknown');

/**
 * The stage the place was put on, or that it is only being watched.
 *
 * What this screen chose lives in the screen and what it wrote lives on the
 * server, and only the second of those survives a locked phone. So where the
 * flow has no answer of its own it falls back to the stage the place is
 * actually on, and says nothing at all - null, for the question to be asked
 * again - until that is known: "nothing set yet" is a claim about the world,
 * and a ticked step is the worst place to guess one.
 */
export const doingSummary = ({ chosen, applied }: Doing, onServer: GrowthStage | null | undefined, t: Translate): string | null => {
  const stage = applied?.stage ?? (chosen === MEASURE ? null : onServer);

  if (stage) return t('claim.doing.onStage', { stage: t(`home.stage.${stage}`) });
  if (chosen === MEASURE) return t('claim.doing.measuring');

  return stage === null ? t('claim.doing.nothingYet') : null;
};

/** What the device reported, rather than anything that was set up in the step. */
export const hardwareSummary = (device: Device | null, sockets: SocketPage | undefined, t: Translate): string =>
  `${t('claim.code.sockets', { count: sockets?.items.length ?? 0 })} · ${t('claim.code.camera', { name: cameraName(device, t) })}`;

/**
 * What to call the device. A claim names it after its type where nobody has
 * named it yet, and a type is a key rather than a word, so the list of types is
 * what turns it into one.
 */
export const deviceName = (device: Device, t: Translate): string =>
  device.name && device.name !== device.type ? device.name : t(`devices.type.${device.type}`, { defaultValue: device.type });

/** The tail of the paired camera's id, which is as much of it as anybody reads off a screen. */
export const cameraName = (device: Device | null, t: Translate): string => {
  const paired = device?.state.hardware.webcam_did;

  return paired && paired !== 'none' ? paired.slice(-6).toUpperCase() : t('claim.code.noCamera');
};
