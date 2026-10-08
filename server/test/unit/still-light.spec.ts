import sharp from 'sharp';
import { monochromeOf } from '@modules/v1/camera/still-light';

/**
 * Whether a still came out in colour, measured once when it is stored: a
 * camera that finds its tent dark switches to its night mode and sends grey,
 * which is how a place without a lamp tells its night (ADR 0006).
 */

/** A 320x180 picture whose every pixel is drawn by `pixel`, as a JPEG the way a camera sends one. */
const jpeg = (pixel: (x: number, y: number) => [number, number, number]): Promise<Buffer> => {
  const width = 320;
  const height = 180;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 3);
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
};

describe('the colour of a still', () => {
  it('is grey from a camera in its night mode', async () => {
    // Every channel equal in every pixel, with the shapes of a tent in it.
    const night = await jpeg((x, y) => {
      const level = (x * 3 + y * 5) % 200;
      return [level, level, level];
    });

    expect(await monochromeOf(night)).toBe(true);
  });

  it('is in colour by day', async () => {
    const day = await jpeg((x, y) => (y > 120 ? [70, 130, 50] : x % 40 < 20 ? [200, 190, 220] : [150, 140, 160]));

    expect(await monochromeOf(day)).toBe(false);
  });

  it('is grey from a tent too dark to show anything, and from a picture of one channel', async () => {
    const black = await jpeg(() => [3, 3, 3]);
    const oneChannel = await sharp(await jpeg(() => [90, 90, 90]))
      .toColourspace('b-w')
      .jpeg()
      .toBuffer();

    expect(await monochromeOf(black)).toBe(true);
    expect((await sharp(oneChannel).metadata()).channels).toBe(1);
    expect(await monochromeOf(oneChannel)).toBe(true);
  });

  it('says nothing of a picture it cannot read', async () => {
    expect(await monochromeOf(Buffer.from('not a picture'))).toBeNull();
  });
});
