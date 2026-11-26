import type { Camera, Device, Firmware, SpaceKind, TimelineDevice } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';

/** What a device is called by: a device the account holds, or one an answer names that it may hold no longer. */
export type Called = Pick<Device, 'id' | 'name' | 'type'>;

/**
 * What a device is called wherever one is written down.
 *
 * A claim stores the device's type where nobody has said anything else, and a
 * type is a key rather than a word, so a stored name that is exactly the type
 * is no name at all: drawn as it stands it reads as lowercase English, in the
 * German app as much as in the English one. Every line that prints a device
 * goes through here, so the same hardware is called the same thing under
 * Steuerung, under a stream address and beside a camera that has just been
 * paired.
 */
export const givenName = (device: Pick<Device, 'name' | 'type'>): string | null => (device.name && device.name !== device.type ? device.name : null);

/** The last four letters or figures of the id: a tail cut by position begins with a hyphen ("-FAN-1"). */
const deviceTag = (device: Called): string =>
  device.id
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toUpperCase();

/** The six kinds a place is, in the order they are offered; a room is none of them - it groups places. Their words are `place.edit.kind.*`. */
export const PLACE_KINDS: readonly SpaceKind[] = ['tent', 'fridge', 'balcony', 'dry_box', 'greenhouse', 'other'];

/**
 * The kind of place a device of this type stands in when a place is made for
 * it: a fridge module in a fridge, a tent controller in a tent. For anything
 * else it depends on who makes the place (`rest`): a move or a removal says
 * nothing about it, while a claim makes a tent, which is what its "Zelt 2"
 * says.
 */
export const placeKindOf = (type: string, rest: SpaceKind = 'other'): SpaceKind =>
  type === 'fridge' ? 'fridge' : type === 'controller' ? 'tent' : rest;

/** A device type in words: the type is the firmware's key for itself, and a key is not a word. */
export const typeName = (type: string, t: Translate): string => t(`devices.type.${type}`, { defaultValue: type });

/** What to call a device inside a sentence, where the sentence already says which one is meant. */
export const deviceName = (device: Pick<Device, 'name' | 'type'>, t: Translate): string => givenName(device) ?? typeName(device.type, t);

/**
 * What to call a device where the name is the whole of its row. A list of six
 * unnamed controllers would be one word repeated, so an unnamed one carries the
 * tail of its id as well - the same few characters the claim summary prints,
 * which is what a person has to hand to tell two of a kind apart.
 *
 * Only where there are two of a kind, though. Given the account's devices, one
 * that nothing else would be called alike is called by its name alone: a grower
 * with one fridge module read "Fridge module · DC891B" on one screen and the
 * place's name on the next, and the six characters told nothing apart. Without
 * the list there is no telling, and the tag stays.
 *
 * `among` is the list the name is read in - the devices of one place on its
 * card, its own page and the sheets opened from either (`standingWith`).
 */
export const deviceTitle = (device: Called, t: Translate, among?: readonly Called[]): string => {
  const name = givenName(device);
  if (name) return name;

  const word = deviceName(device, t);
  const alike = among?.some(other => other.id !== device.id && deviceName(other, t) === word) ?? true;

  return alike ? t('devices.unnamed', { type: word, tag: deviceTag(device) }) : word;
};

/**
 * What a line or an alert of a place calls the device it is about, alike in Verlauf, on Start, in the diary and in
 * Meldungen: as `deviceTitle` among the devices of that place - those standing there now and, of the ones the reader
 * holds no longer or never did, what the answer says its record names (`told`, `SpaceTimeline.devices` and its like),
 * which is all that is known of them. A line that names no place is read where the device stands. `alone` is whether
 * the place is known to hold no other, where a line need not say which device it means.
 *
 * Where the lines are read over a stretch - a day of the diary, Verlauf's window - they are named among the devices
 * that stood there in it (`stood`), whoever holds them now: the diary said "Gerät offline" of a day a lamp module
 * stood beside the controller, which Verlauf named, once the lamp was given up.
 */
export const calledIn = (
  deviceId: string,
  spaceId: string | null,
  t: Translate,
  every: readonly Pick<Device, 'id' | 'name' | 'type' | 'spaceId'>[] | undefined,
  told: readonly TimelineDevice[] = [],
  stood?: readonly string[],
): { name: string; alone: boolean } | null => {
  const held = new Set((every ?? []).map(one => one.id));
  const place = spaceId ?? every?.find(one => one.id === deviceId)?.spaceId ?? null;
  const ofTold = (one: TimelineDevice): Called => ({ id: one.deviceId, name: one.name, type: one.type });
  const known = (id: string): Called | undefined => {
    const said = told.find(one => one.deviceId === id);
    return every?.find(one => one.id === id) ?? (said && ofTold(said));
  };
  const among: Called[] = stood
    ? [...new Set([deviceId, ...stood])].flatMap(id => known(id) ?? [])
    : [
        ...(every ?? []).filter(one => one.id === deviceId || (place !== null && one.spaceId === place)),
        ...told.filter(one => !held.has(one.deviceId)).map(ofTold),
      ];
  const device = among.find(one => one.id === deviceId);
  return device ? { name: deviceTitle(device, t, among), alone: among.length === 1 } : null;
};

/** The devices standing where a device stands (or in `spaceId`, where it is about to), itself among them: the list its card is drawn in. */
export const standingWith = (device: Device, every: Device[] | undefined, spaceId: string | null = device.spaceId): Device[] | undefined =>
  every?.filter(one => one.id === device.id || one.spaceId === spaceId);

/**
 * The few characters printed on the cam, which is what it is called before
 * anybody has called it anything. A camera the cloud reached without a pairing
 * id falls back to its own, which is no worse a label and is never empty.
 */
export const cameraTag = (camera: Pick<Camera, 'did' | 'id'>): string => camTag(camera.did ?? camera.id);

/** The same few characters of a pairing id a device reports before the camera exists. */
export const camTag = (did: string): string => did.slice(-4).toUpperCase();

/**
 * What to call a camera in its row. A camera a controller pairs is made from
 * that controller's report and named after it, so a camera carrying the
 * carrier's name or its type key word for word has no name of its own - two
 * rows would read alike - and is drawn by what is printed on the cam instead.
 * Anything else a person typed is theirs and is left alone.
 */
export const cameraTitle = (camera: Camera, carrier: Device | null, t: Translate): string =>
  carrier && [carrier.type, carrier.name].includes(camera.name) ? t('cameras.add.found.title', { tag: cameraTag(camera) }) : camera.name;

/**
 * Which build a device is on, in the words that say which one.
 *
 * `version` comes first because it is the only field that tells two builds of
 * one class apart: the build container stamps it with the commit and the branch
 * it came from, while every build carried over from the old cloud is *named*
 * after its class, so two fridges on two different builds both read "fridge".
 * With neither there is nothing to say, and nothing is said - the uuid the
 * device reports means nothing to a grower and cannot be compared with
 * anything.
 */
export const buildLabel = (build: Pick<Firmware, 'version' | 'name'> | undefined): string | null => build?.version || build?.name || null;
