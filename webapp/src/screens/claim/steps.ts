import type {
  Device,
  GerminationChoices,
  GrowthStage,
  Me,
  PresetApplication,
  PresetApplicationCreate,
  SocketPage,
  Space,
} from '@fg2/shared-types/v1';
import { nameKey, numbered } from '@fg2/shared-types/v1-schemas/place-names.js';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import type { Translate } from '@/i18n/i18n';
import { pairsACam } from '@/screens/camera/add/pairers';
import { alarmsReach, channelsLabel, reachedBy } from '@/screens/notifications/reach';
import { camTag, placeKindOf } from '@/ui/naming';

/**
 * What each step of the claim flow has settled, and the one line it says once
 * it is closed. A step is only rendered while it is open, so what it decided
 * cannot live in it: the screen holds the answers and these put them into the
 * sentence the ticked step carries.
 */

/** Monitoring only: the place is watched and charted, and nothing is written to the controller. */
export const MEASURE = 'measure';

export interface Doing {
  chosen: GrowthStage | typeof MEASURE | null;
  applied: PresetApplication | null;
  /** What germination is to do about the humidity, where a switch was moved; the device's own stands for the rest. */
  germination?: Partial<GerminationChoices>;
}

/** The write the step makes, from its own button or from the screen's: the stage, and with germination the switches that were moved. */
export const presetBodyOf = (stage: GrowthStage, doing: Doing): PresetApplicationCreate =>
  stage === 'germination' && doing.germination && Object.keys(doing.germination).length > 0
    ? { stage, germinationChoices: doing.germination }
    : { stage };

export const NOTHING_DOING: Doing = { chosen: null, applied: null };

/** What is asked once a device is claimed, in the order it is asked. */
export const ASKED = ['place', 'doing', 'hardware', 'notify', 'grow'] as const;
export type Asked = (typeof ASKED)[number];

/** Whether a device with targets of its own - a controller, a fridge module - stands in the place beside this one. */
export const climateIn = (devices: readonly Device[], spaceId: string | null, beside: string): boolean =>
  devices.some(one => one.spaceId === spaceId && one.id !== beside && OWN_CLIMATE_TYPES.includes(one.type));

/**
 * The places a device is offered, one that holds a climate before one that does not. The first is where a fan, a
 * socket or a lamp hangs until somebody says otherwise: its claim names it (`joinSpaceId`) before the type is known.
 */
export const joinOrder = (places: readonly Space[], devices: readonly Device[], but = ''): Space[] =>
  [true, false].flatMap(held => places.filter(one => climateIn(devices, one.id, but) === held));

/**
 * The questions a claim will ask: where it hangs where there is more than one
 * answer, a climate only of the device that sets its place's (`beside`), a
 * camera of one that can carry it, how alarms arrive of an account they do
 * not reach yet, and what grows unless it said no to the diary. The head
 * counts them once where it hangs is settled; no later answer adds one.
 */
export const planOf = (device: Pick<Device, 'type'>, place: boolean, beside: boolean, me: Me | undefined): Asked[] => {
  const asked = { place, doing: OWN_CLIMATE_TYPES.includes(device.type) && !beside, hardware: pairsACam(device), notify: !me || !alarmsReach(me) };

  return ASKED.filter(step => (step === 'grow' ? me?.preferences.diary !== 'off' : asked[step]));
};

/** A sentence about where a device hangs, in the verb of its kind: a fan hangs, a socket is plugged in, and both say so every time. */
export const hangWords = (t: Translate, form: 'title' | 'done' | 'joined', type: string, values?: Record<string, string>): string =>
  t(`claim.air.${form}.${type}`, { ...values, defaultValue: t(`claim.air.${form}.other`, values) });

/**
 * What to call a place the app makes by itself for a device - a fridge for a
 * fridge module, a tent for everything else, which its page changes: the word
 * for what it is, in the language the grower reads - the server has none -
 * and the first of its kind without a number, "Zelt", then "Zelt 2".
 */
export const newPlaceName = (type: string, spaces: readonly Pick<Space, 'name'>[], t: Translate): string =>
  numbered(t(`claim.place.newName.${placeKindOf(type, 'tent')}`), new Set(spaces.map(one => nameKey(one.name))));

/** The place by its name, and what kind of place it is where the name does not say. */
export const placeSummary = (space: Space | null, t: Translate): string => {
  if (!space) return t('claim.place.unknown');
  const kind = t(`place.edit.kind.${space.kind}`, { defaultValue: space.kind });

  return nameKey(space.name).includes(nameKey(kind)) ? space.name : `${space.name} · ${kind}`;
};

/**
 * The stage the place was put on, or that it is only being watched. What the
 * screen chose does not survive a locked phone, so where the flow has no
 * answer of its own it falls back to the stage the place is on, and says
 * nothing - null, for the question to be asked again - until that is known:
 * "nothing set yet" is a claim about the world, and no ticked step guesses one.
 */
export const doingSummary = ({ chosen, applied }: Doing, onServer: GrowthStage | null | undefined, t: Translate): string | null => {
  const stage = applied?.stage ?? (chosen === MEASURE ? null : onServer);

  if (stage) return t('claim.doing.onStage', { stage: t(`home.stage.${stage}`) });
  if (chosen === MEASURE) return t('claim.doing.measuring');

  return stage === null ? t('claim.doing.nothingYet') : null;
};

/** What the device reported, rather than anything that was set up in the step. */
export const hardwareSummary = (device: Device | null, sockets: SocketPage | undefined, t: Translate, camOnly = false): string =>
  camOnly
    ? t('claim.code.camera', { name: cameraName(device, t) })
    : `${t('claim.code.sockets', { count: sockets?.items.length ?? 0 })} · ${t('claim.code.camera', { name: cameraName(device, t) })}`;

/** How a critical alarm reaches the account, or that nothing does; nothing at all while the account has yet to answer. */
export const notifySummary = (me: Me | undefined, t: Translate): string | null => {
  if (!me) return null;

  return alarmsReach(me) ? t('claim.notify.reaches', { channels: channelsLabel(t, reachedBy(me)) }) : t('claim.notify.none');
};

/** The paired camera by the tail of its id, as its row will be called ("Terp Cam · 7171"). */
export const cameraName = (device: Device | null, t: Translate): string => {
  const paired = device?.state.hardware.webcam_did;

  return paired && paired !== 'none' ? camTag(paired) : t('claim.code.noCamera');
};
