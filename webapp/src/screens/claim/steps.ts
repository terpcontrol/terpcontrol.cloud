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
import type { Translate } from '@/i18n/i18n';
import { pairsACam } from '@/screens/camera/add/pairers';
import { alarmsReach, channelsLabel, reachedBy } from '@/screens/notifications/reach';

/**
 * What each step of the claim flow has settled, and the one line it says once
 * it is closed.
 *
 * A step is only rendered while it is open, so what it decided cannot live in
 * it: the screen holds the answers and these put them into the sentence the
 * ticked step carries. They are here rather than beside the steps because that
 * is the one thing the five have in common.
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

/** The types that hold a climate by targets of their own; a fan, a socket and a lamp hang in the climate of one of these. */
export const OWN_CLIMATE = ['controller', 'fridge'];

/** Whether a device with targets of its own stands in the place beside this one. */
export const climateIn = (devices: readonly Device[], spaceId: string | null, beside: string): boolean =>
  devices.some(one => one.spaceId === spaceId && one.id !== beside && OWN_CLIMATE.includes(one.type));

/**
 * The questions a claim will ask, decided once so that the count in the head
 * holds: where it hangs where there is more than one answer, a climate only of
 * a device that sets one, a camera of one that can carry it, how alarms arrive
 * of an account they do not reach yet, and what grows unless it said no to the
 * diary. An answer can end the flow early; none adds a question.
 */
export const planOf = (device: Pick<Device, 'type'>, place: boolean, me: Me | undefined): Asked[] => {
  const asked = { place, doing: OWN_CLIMATE.includes(device.type), hardware: pairsACam(device), notify: !me || !alarmsReach(me) };

  return ASKED.filter(step => (step === 'grow' ? me?.preferences.diary !== 'off' : asked[step]));
};

/** A sentence about where a device hangs, in the verb of its kind: a fan hangs, a socket is plugged in, and both say so every time. */
export const hangWords = (t: Translate, form: 'title' | 'done' | 'joined', type: string, values?: Record<string, string>): string =>
  t(`claim.air.${form}.${type}`, { ...values, defaultValue: t(`claim.air.${form}.other`, values) });

/** What a place the app makes by itself for a device is: a fridge for a fridge module, a tent for everything else. Its page changes that. */
export const newPlaceKind = (type: string): 'fridge' | 'tent' => (type === 'fridge' ? 'fridge' : 'tent');

/**
 * What to call such a place: the word for what it is, in the language the
 * grower reads - the server has none - and the first of its kind without a
 * number, "Zelt", then "Zelt 2".
 */
export const newPlaceName = (type: string, spaces: readonly Pick<Space, 'name'>[], t: Translate): string =>
  numbered(t(`claim.place.newName.${newPlaceKind(type)}`), new Set(spaces.map(one => nameKey(one.name))));

/** The place, and what kind of place it is. */
export const placeSummary = (space: Space | null, t: Translate): string =>
  space ? `${space.name} · ${t(`place.edit.kind.${space.kind}`, { defaultValue: space.kind })}` : t('claim.place.unknown');

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
export const hardwareSummary = (device: Device | null, sockets: SocketPage | undefined, t: Translate, camOnly = false): string =>
  camOnly
    ? t('claim.code.camera', { name: cameraName(device, t) })
    : `${t('claim.code.sockets', { count: sockets?.items.length ?? 0 })} · ${t('claim.code.camera', { name: cameraName(device, t) })}`;

/** How a critical alarm reaches the account, or that nothing does; nothing at all while the account has yet to answer. */
export const notifySummary = (me: Me | undefined, t: Translate): string | null => {
  if (!me) return null;

  return alarmsReach(me) ? t('claim.notify.reaches', { channels: channelsLabel(t, reachedBy(me)) }) : t('claim.notify.none');
};

/** The tail of the paired camera's id, which is as much of it as anybody reads off a screen. */
export const cameraName = (device: Device | null, t: Translate): string => {
  const paired = device?.state.hardware.webcam_did;

  return paired && paired !== 'none' ? paired.slice(-6).toUpperCase() : t('claim.code.noCamera');
};
