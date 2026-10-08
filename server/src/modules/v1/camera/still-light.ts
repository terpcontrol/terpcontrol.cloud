import sharp from 'sharp';

/**
 * How bright a picture has to be, on average and out of 255, to show anything
 * of a tent. A tent with its lamp off and no night mode on the camera comes out
 * well under it; anything the lamp lights, and a camera's own night vision,
 * comes out well over.
 */
const DARK_LUMA = 24;

/**
 * Whether a still was taken with the light on, from the picture alone: false
 * for one too dark to show anything, and null otherwise - a picture bright
 * enough to see is not proof the lamp was on, because a camera's night mode
 * makes the dark tent visible too. What the controller says about its light is
 * the better witness and is asked first wherever there is one.
 */
export const litFromPicture = async (still: Buffer): Promise<boolean | null> => {
  try {
    const { channels } = await sharp(still).stats();
    const [red, green, blue] = channels.length >= 3 ? channels : [channels[0], channels[0], channels[0]];
    const luma = 0.299 * red.mean + 0.587 * green.mean + 0.114 * blue.mean;

    return luma < DARK_LUMA ? false : null;
  } catch {
    return null;
  }
};

/**
 * How far apart, on average and out of 255, the three colour channels of a
 * pixel may lie in a picture that has no colour. A camera in its night mode
 * sends pure grey - every channel equal in every pixel - and a dark tent
 * without one comes out black; a tent in colour, plants and walls under a
 * lamp, measured 20 to 50 on the development cameras.
 */
const GREY_SPREAD = 4;

/** Wide enough to measure a picture's colour, small enough to decode in a few milliseconds. */
const SAMPLE_WIDTH = 192;

/**
 * Whether a still came out without colour: true for a camera that has switched
 * to its night (infrared) mode, which it does once its own light sensor finds
 * the tent dark, and for a picture too dark to show anything; false for one in
 * colour; null where the picture cannot be read. It is what tells the day from
 * the night where nothing else in a place can: a smart plug, which has no lamp,
 * goes by it when it keeps no schedule of its own (`StillDaylightService`).
 */
export const monochromeOf = async (still: Buffer): Promise<boolean | null> => {
  try {
    const { data, info } = await sharp(still)
      .resize({ width: SAMPLE_WIDTH, withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels < 3) return true;

    let spread = 0;
    for (let at = 0; at < data.length; at += info.channels) {
      spread += Math.max(data[at], data[at + 1], data[at + 2]) - Math.min(data[at], data[at + 1], data[at + 2]);
    }
    return spread / (data.length / info.channels) < GREY_SPREAD;
  } catch {
    return null;
  }
};
