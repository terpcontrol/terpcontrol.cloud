import type { Camera, Device } from '@fg2/shared-types/v1';

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
const given = (device: Device): string | null => (device.name && device.name !== device.type ? device.name : null);

/** The tail of the id, which is as much of it as anybody reads off a screen or a label. */
export const deviceTag = (device: Device): string => device.id.slice(-6).toUpperCase();

/** What to call a device inside a sentence, where the sentence already says which one is meant. */
export const deviceName = (device: Device, t: Translate): string => given(device) ?? t(`devices.type.${device.type}`, { defaultValue: device.type });

/**
 * What to call a device where the name is the whole of its row. A list of six
 * unnamed controllers would be one word repeated, so an unnamed one carries the
 * tail of its id as well - the same few characters the claim summary prints,
 * which is what a person has to hand to tell two of a kind apart.
 */
export const deviceTitle = (device: Device, t: Translate): string =>
  given(device) ?? t('devices.unnamed', { type: deviceName(device, t), tag: deviceTag(device) });

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
