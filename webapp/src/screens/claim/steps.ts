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

/** The place, and what kind of place it is. */
export const placeSummary = (space: Space | null, t: Translate): string =>
  space ? `${space.name} · ${t(`claim.place.kind.${space.kind}`)}` : t('claim.place.unknown');

/** The stage the place was put on, or that it is only being watched. */
export const doingSummary = ({ chosen, applied }: Doing, t: Translate): string =>
  applied
    ? t('claim.doing.onStage', { stage: t(`home.stage.${applied.stage}`) })
    : chosen === MEASURE
      ? t('claim.doing.measuring')
      : t('claim.doing.nothingYet');

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
