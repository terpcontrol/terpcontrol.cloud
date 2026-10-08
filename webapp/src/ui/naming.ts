import type { Camera, Device, Firmware } from '@fg2/shared-types/v1';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What a device is called wherever one is written down.
 *
 * A claim stores the device's type where nobody has said anything else, and a
 * type is a key rather than a word, so a stored name that is exactly the type
 * is no name at all: drawn as it stands it reads as lowercase English, in the
 * German app as much as in the English one. Every line that prints a device
 * goes through here, so the same hardware is called the same thing on the
 * Devices tab, under a stream address and beside a camera that has just been
 * paired.
 */
export const givenName = (device: Device): string | null => (device.name && device.name !== device.type ? device.name : null);

/** The tail of the id, which is as much of it as anybody reads off a screen or a label. */
export const deviceTag = (device: Device): string => device.id.slice(-6).toUpperCase();

/** A device type in words: the type is the firmware's key for itself, and a key is not a word. */
export const typeName = (type: string, t: Translate): string => t(`devices.type.${type}`, { defaultValue: type });

/** What to call a device inside a sentence, where the sentence already says which one is meant. */
export const deviceName = (device: Device, t: Translate): string => givenName(device) ?? typeName(device.type, t);

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
 */
export const deviceTitle = (device: Device, t: Translate, among?: Device[]): string => {
  const name = givenName(device);
  if (name) return name;

  const word = deviceName(device, t);
  const alike = among?.some(other => other.id !== device.id && deviceName(other, t) === word) ?? true;

  return alike ? t('devices.unnamed', { type: word, tag: deviceTag(device) }) : word;
};

/**
 * The few characters printed on the cam, which is what it is called before
 * anybody has called it anything. A camera the cloud reached without a pairing
 * id falls back to its own, which is no worse a label and is never empty.
 */
export const cameraTag = (camera: Camera): string => (camera.did ?? camera.id).slice(-4).toUpperCase();

/**
 * What to call a camera in its row. A camera a controller pairs is made from
 * that controller's report and was once named after it, so a camera carrying
 * the carrier's type key word for word has no name of its own either - it is
 * the same key twice removed - and is drawn by what is printed on the cam
 * instead. Anything a person typed is theirs and is left alone.
 */
export const cameraTitle = (camera: Camera, carrier: Device | null, t: Translate): string =>
  carrier && camera.name === carrier.type ? t('cameras.add.found.title', { tag: cameraTag(camera) }) : camera.name;

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
