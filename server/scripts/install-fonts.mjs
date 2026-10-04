// Puts the app's face where the image renderer can find it.
//
// A film's overlays and a shared link's card are SVG layers that sharp hands to
// librsvg, which asks fontconfig for "Inter". Fontconfig
// reads TrueType and OpenType files only, and the @fontsource packages ship the
// faces as WOFF and WOFF2 for the web. WOFF1 is the same sfnt tables, each one
// zlib-compressed, so this unpacks the weights the overlays set into plain .ttf
// files and writes a fonts.conf that adds their directory to the system's own.
// The image build runs it once and points FONTCONFIG_FILE at the result:
//
//   node scripts/install-fonts.mjs /app/fonts
//
// Only the weights the server draws with are unpacked - Inter at 400, 600 and
// 700 - in the latin and latin-ext subsets, so a German caption keeps its
// umlauts in the same face.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const FACES = [{ pkg: '@fontsource/inter', family: 'Inter', file: 'inter', weights: [400, 600, 700] }];

// A static instance names its family after its weight where the weight is not
// one of the four a legacy family can hold: the 600 files call themselves
// "Inter SemiBold", so an SVG asking for "Inter" at weight 600 was never
// matched with them. The configuration
// files each such face under its family's own name as it is scanned; the
// weight it carries is what tells the instances apart.
const WEIGHT_NAMES = { 600: 'SemiBold' };
const SUBSETS = ['latin', 'latin-ext'];

const target = resolve(process.argv[2] ?? 'fonts');
const require = createRequire(import.meta.url);

/** A WOFF1 file as the sfnt it wraps: the same tables, uncompressed, behind a TrueType offset table. */
export const woffToSfnt = woff => {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF1 file');
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables = [];
  for (let index = 0; index < count; index++) {
    const at = 44 + index * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compressed = woff.readUInt32BE(at + 8);
    const length = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compressed);
    tables.push({
      tag: woff.readUInt32BE(at),
      checksum: woff.readUInt32BE(at + 16),
      data: compressed < length ? inflateSync(raw) : raw,
    });
  }

  const pad = length => (length + 3) & ~3;
  let power = 1;
  let log = 0;
  while (power * 2 <= count) {
    power *= 2;
    log++;
  }
  const header = 12 + count * 16;
  const size = tables.reduce((total, table) => total + pad(table.data.length), header);
  const out = Buffer.alloc(size);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(count, 4);
  out.writeUInt16BE(power * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(count * 16 - power * 16, 10);

  let offset = header;
  tables.forEach((table, index) => {
    const at = 12 + index * 16;
    out.writeUInt32BE(table.tag, at);
    out.writeUInt32BE(table.checksum, at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(table.data.length, at + 12);
    table.data.copy(out, offset);
    offset += pad(table.data.length);
  });
  return out;
};

mkdirSync(target, { recursive: true });
for (const face of FACES) {
  const files = join(dirname(require.resolve(`${face.pkg}/package.json`)), 'files');
  for (const weight of face.weights) {
    for (const subset of SUBSETS) {
      const name = `${face.file}-${subset}-${weight}-normal`;
      writeFileSync(join(target, `${name}.ttf`), woffToSfnt(readFileSync(join(files, `${name}.woff`))));
    }
  }
}

const renames = FACES.flatMap(face =>
  face.weights
    .filter(weight => WEIGHT_NAMES[weight])
    .map(
      weight => `  <match target="scan">
    <test name="family"><string>${face.family} ${WEIGHT_NAMES[weight]}</string></test>
    <edit name="family" mode="assign" binding="same"><string>${face.family}</string></edit>
  </match>`,
    ),
);

// The system's own configuration first, so DejaVu stays the fallback for a
// character the face does not have, and its cache directory is the one used.
writeFileSync(
  join(target, 'fonts.conf'),
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${target}</dir>
${renames.join('\n')}
</fontconfig>
`,
);
console.log(`fonts in ${target}`);
