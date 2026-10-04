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
