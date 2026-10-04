#!/usr/bin/env node
/**
 * Derives the app's two logo files from the brand's logo.png, the one
 * terpcontrol.com serves (4092 x 836, transparent), so neither is ever
 * retouched by hand:
 *
 *   public/assets/brand/logo.png          the logo as it is, 960 px wide
 *   public/assets/brand/logo-reverse.png  the same for a dark surface
 *
 * The logo is drawn in three inks on transparency - the blue of the shield,
 * CONTROL and the tagline; the green of the leaf and TERP; and white, knocked
 * into the blue badges and the leaf's veins - each anti-aliased against the
 * others. The reverse is the treatment the site's dark sections give the brand:
 * white type with the green kept. Per pixel, in 0..1:
 *
 *   blue  = clamp((b - r) / 0.376)   0.376 is b - r of the shield's blue
 *   green = clamp((g - b) / 0.28)    0.28 is g - b of the leaf's pale green
 *
 * White has neither, so it drops out and the dark surface shows where it was.
 * Blue becomes white; green keeps its own colour, unblended from the white it
 * was smoothed against; the pixel's cover is how much of either it holds.
 *
 * sharp is the server's, so this runs from `server/`:
 *
 *   node ../webapp/scripts/derive-logo.mjs <path to logo.png>
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(join(process.cwd(), 'package.json'))('sharp');
const source = resolve(process.argv[2] ?? 'logo.png');
const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'brand');
const WIDTH = 960;
const clamp = value => Math.min(Math.max(value, 0), 1);

mkdirSync(target, { recursive: true });
await sharp(source).resize({ width: WIDTH }).png({ compressionLevel: 9 }).toFile(join(target, 'logo.png'));

const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const reverse = Buffer.alloc(data.length);
for (let at = 0; at < data.length; at += 4) {
  const [r, g, b] = [data[at], data[at + 1], data[at + 2]].map(channel => channel / 255);
  const blue = clamp((b - r) / 0.376);
  const green = clamp((g - b) / 0.28);
  const cover = Math.min(1, blue + green);
  if (cover === 0 || data[at + 3] === 0) continue;

  for (let channel = 0; channel < 3; channel++) {
    const unblended = clamp(1 - (1 - data[at + channel] / 255) / cover);
    reverse[at + channel] = Math.round(((blue + green * unblended) / (blue + green)) * 255);
  }
  reverse[at + 3] = Math.round(data[at + 3] * cover);
}

await sharp(reverse, { raw: { width: info.width, height: info.height, channels: 4 } })
  .resize({ width: WIDTH })
  .png({ compressionLevel: 9 })
  .toFile(join(target, 'logo-reverse.png'));
console.log(`logos in ${target}`);
