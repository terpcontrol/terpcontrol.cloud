import sharp from 'sharp';
import { MediaAspect, MediaOverlays, MediaQuality, SeriesPoint } from '@fg2/shared-types/v1';
import { TimelapseContext } from './timelapse-context.service';

/**
 * What is drawn over a frame, and what the frames are laid out as.
 *
 * Everything here is drawn as one SVG layer and composited onto the picture,
 * the way the watermark already is: ffmpeg's text filter wants a font and a
 * build with freetype in it, and a layer wants neither. It also means the day
 * counter, the curve and the caption are one overlay per frame rather than
 * three filters, so a film of a week is one composite per frame.
 *
 * The type is the app's: Albert Sans for words and figures, and its medium for
 * the day counter and a reading, which are what a frame is read for - nothing
 * in the app is set bolder. librsvg finds a face through fontconfig, and only as a
 * TrueType or OpenType file - the WOFF and WOFF2 the web packages ship are not
 * read - so the image unpacks the @fontsource faces into .ttf files when it is
 * built and points FONTCONFIG_FILE at them (scripts/install-fonts.mjs). Run
 * anywhere without that, the same layer draws in DejaVu or the system's sans,
 * and the film is readable either way.
 */

/**
 * The app's dark mode, so a film reads as the app it came out of - and so does
 * the card a shared link is drawn as, which is the same trick: an SVG layer
 * composited onto a picture by sharp. A picture is seen through a plate at
 * night-time strength whatever mode the viewer's app is in, so the plate is the
 * ground of the dark theme and the lines are its signal colours.
 */
export const INK = '#e9e8e3';
export const MUTED = '#adaba3';
export const PANEL = 'rgb(20,22,26)';
const TEMPERATURE = '#e8a587';
const HUMIDITY = '#8ac1d7';

export const TEXT_FAMILY = 'Albert Sans, DejaVu Sans, sans-serif';

/** How far either side of a diary line its caption is shown. */
const CAPTION_WINDOW_MS = 30 * 60 * 1000;

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

/** The long side of a film, by the resolution it was asked for. */
const ASPECT_LONG_SIDE: Readonly<Record<MediaQuality, number>> = { sd: 1280, hd: 1920 };

const ASPECT_RATIOS: Readonly<Record<MediaAspect, number>> = { '16_9': 16 / 9, '9_16': 9 / 16, '1_1': 1 };

export interface FrameSize {
  width: number;
  height: number;
}

/** Even on both sides: h.265 encodes in macroblocks and refuses an odd dimension. */
const even = (value: number): number => Math.max(2 * Math.round(value / 2), 2);

/** What one frame of this film measures. */
export const sizeFor = (aspect: MediaAspect, quality: MediaQuality): FrameSize => {
  const long = ASPECT_LONG_SIDE[quality];
  const ratio = ASPECT_RATIOS[aspect];

  return ratio >= 1 ? { width: even(long), height: even(long / ratio) } : { width: even(long * ratio), height: even(long) };
};

export const DEFAULT_ASPECT: MediaAspect = '16_9';

export const DEFAULT_OVERLAYS: MediaOverlays = { dayCounter: false, climate: false, entries: false };

/**
 * Whether the light was off when this frame was taken, from the controller's
 * own light output. Null - nothing was measured - counts as lit: a frame is
 * dropped for a night that was measured, never for one nobody can confirm.
 */
export const wasDark = (at: Date, light: SeriesPoint[]): boolean => {
  const value = nearest(at, light);
  return value !== null && value <= 0;
};

/** The value measured closest to an instant, or null where nothing was. */
const nearest = (at: Date, points: SeriesPoint[]): number | null => {
  let best: { distance: number; value: number } | null = null;

  for (const point of points) {
    if (point.value === null) continue;

    const distance = Math.abs(new Date(point.measuredAt).getTime() - at.getTime());
    if (best === null || distance < best.distance) best = { distance, value: point.value };
  }

  return best?.value ?? null;
};

export interface OverlayFrame {
  at: Date;
  width: number;
  height: number;
}

/**
 * The layer for one frame, or null where every overlay that was asked for has
 * nothing to say at this instant - a span with no diary line and no controller
 * then costs no composite at all.
 */
export const overlayLayer = (frame: OverlayFrame, overlays: MediaOverlays, context: TimelapseContext): string | null => {
  const parts = [
    overlays.dayCounter ? dayBadge(frame, context) : null,
    overlays.climate ? climateCurve(frame, context) : null,
    overlays.entries ? caption(frame, context) : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) return null;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}">${parts.join('')}</svg>`;
};

/** The word in front of the day number, in the language the account was last used in. */
const DAY_WORD: Record<string, string> = { de: 'Tag', en: 'Day' };

/** "Day 34", which is how a grower says where a grow is. */
const dayBadge = (frame: OverlayFrame, context: TimelapseContext): string | null => {
  if (context.growStartedAt === null) return null;

  const day = Math.floor((frame.at.getTime() - context.growStartedAt.getTime()) / MS_IN_A_DAY) + 1;
  if (day < 1) return null;

  const size = Math.round(frame.height / 22);
  const pad = Math.round(frame.height / 36);
  const width = size * 5;
  const height = Math.round(size * 1.9);

  return `<g>
    <rect x="${pad}" y="${pad}" width="${width}" height="${height}" rx="${Math.round(size / 3)}" fill="${PANEL}" fill-opacity="0.58"/>
    <text x="${pad + width / 2}" y="${pad + height / 2}" text-anchor="middle" dominant-baseline="central"
          font-family="${TEXT_FAMILY}" font-size="${size}" font-weight="500" fill="${INK}">${DAY_WORD[context.language ?? 'en'] ?? DAY_WORD.en} ${day}</text>
  </g>`;
};

/**
 * A reading as the app writes it for the owner: its own decimals - one for the
 * temperature, none for the humidity - with the language's decimal mark and a
 * space before the unit ("25,6 °C", "59 %"), never "-0".
 */
export const readingIn = (value: number, decimals: number, unit: string, language: string | undefined): string => {
  // Rounded first, and a rounded -0 made 0 by adding it to 0: "-0,0" is no reading.
  const rounded = Number(value.toFixed(decimals)) + 0;
  const figure = new Intl.NumberFormat(language ?? 'en', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(rounded);
  return `${figure} ${unit}`;
};

/** Where the climate box stands on a frame, which the caption above it takes its width from. */
const climateBox = (frame: OverlayFrame): { left: number; width: number; height: number; pad: number } => {
  const width = Math.round(frame.width * 0.62);
  return { left: Math.round((frame.width - width) / 2), width, height: Math.round(frame.height / 5), pad: Math.round(frame.height / 36) };
};

/**
 * The temperature and the humidity of the whole span, with a cursor on the
 * instant this frame was taken - which is what makes a film of a tent worth
 * watching rather than a film of a plant. The curves and the cursor are drawn
 * inside the box, a stroke's width in from its edges and joined round, so a
 * steep last step does not poke out of it - and under the row of the readings,
 * so a spike does not run through "20,9 °C".
 */
const climateCurve = (frame: OverlayFrame, context: TimelapseContext): string | null => {
  const lines = [
    { points: context.temperature, colour: TEMPERATURE, unit: '°C', decimals: 1 },
    { points: context.humidity, colour: HUMIDITY, unit: '%', decimals: 0 },
  ].filter(line => line.points.some(point => point.value !== null));

  if (lines.length === 0) return null;

  const box = climateBox(frame);
  const { height, pad } = box;
  const top = frame.height - height - pad;
  const size = Math.round(frame.height / 30);
  const inset = Math.max(Math.round(size / 2), STROKE * 2);
  // The plot inside the box, below the readings' row.
  const left = box.left + inset;
  const width = box.width - inset * 2;
  const plotTop = top + Math.round(size * 1.5);
  const plotBottom = top + height - inset;

  const first = new Date(lines[0].points[0].measuredAt).getTime();
  const last = new Date(lines[0].points[lines[0].points.length - 1].measuredAt).getTime();
  const span = Math.max(last - first, 1);
  const cursorX = left + width * clamp((frame.at.getTime() - first) / span);

  const drawn = lines.map(line => {
    const values = line.points.flatMap(point => (point.value === null ? [] : [point.value]));
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = Math.max(high - low, 1);

    // The first command of a path has to be a moveto, and the one that decides
    // it is the first point actually drawn - not the first slot of the series.
    // A span that opens before the readings do, which is every "Today" film
    // asked for before the device's first report of the day and every longer
    // film across a day the device was off, has a null in that slot; the path
    // then began with an L, which is not path data at all, and the renderer
    // drew the panel with no curve in it and said nothing about the curve it
    // had dropped.
    let started = false;

    const path = line.points
      .flatMap((point, index) => {
        if (point.value === null) return [];

        const x = left + (width * index) / Math.max(line.points.length - 1, 1);
        const y = plotBottom - ((point.value - low) / range) * (plotBottom - plotTop);
        const command = started ? 'L' : 'M';
        started = true;

        return [`${command}${x.toFixed(1)} ${y.toFixed(1)}`];
      })
      .join(' ');

    const now = nearest(frame.at, line.points);
    return { path, colour: line.colour, reading: now === null ? null : readingIn(now, line.decimals, line.unit, context.language) };
  });

  // Each reading starts at a fixed place of its own, so one whose width changes
  // from frame to frame moves nothing beside it.
  const readings = drawn
    .flatMap((line, index) =>
      line.reading === null
        ? []
        : [
            `<text x="${left + index * size * 5}" y="${top + size}" font-family="${TEXT_FAMILY}" font-size="${size}"
                   font-weight="500" fill="${line.colour}">${line.reading}</text>`,
          ],
    )
    .join('');

  return `<g>
    <rect x="${box.left}" y="${top}" width="${box.width}" height="${height}" rx="${Math.round(size / 3)}" fill="${PANEL}" fill-opacity="0.45"/>
    ${drawn
      .map(
        line =>
          `<path d="${line.path}" fill="none" stroke="${line.colour}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round"/>`,
      )
      .join('')}
    <line x1="${cursorX.toFixed(1)}" y1="${plotTop}" x2="${cursorX.toFixed(1)}" y2="${plotBottom}" stroke="${MUTED}" stroke-width="1"/>
    ${readings}
  </g>`;
};

/** The width of a curve's line. */
const STROKE = 2;

/** The diary line of this moment, as the board draws it: "Day 26 · topped". */
const caption = (frame: OverlayFrame, context: TimelapseContext): string | null => {
  const line = context.captions.find(entry => Math.abs(entry.at.getTime() - frame.at.getTime()) <= CAPTION_WINDOW_MS);
  if (!line) return null;

  const size = Math.round(frame.height / 26);
  const height = Math.round(size * 2);
  // Over the climate box it stands as wide as that box, so the two read as one column; alone it takes the frame.
  const box = climateBox(frame);
  const over = context.temperature.length > 0;
  const left = over ? box.left : box.pad;
  const width = over ? box.width : frame.width - box.pad * 2;
  const top = frame.height - height - box.pad - (over ? box.height + box.pad : 0);

  return `<g>
    <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${Math.round(size / 3)}"
          fill="${PANEL}" fill-opacity="0.58"/>
    <text x="${left + box.pad}" y="${top + height / 2}" dominant-baseline="central"
          font-family="${TEXT_FAMILY}" font-size="${size}" fill="${INK}">${escapeText(line.text, charactersIn(width - box.pad * 2, size))}</text>
  </g>`;
};

/** About how many characters of the face fit a width at a size: a caption is cut rather than run past its bar. */
const charactersIn = (width: number, size: number): number => Math.max(Math.floor(width / (size * 0.55)), 8);

/** Text somebody typed, being put into an XML document. */
export const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A caption is whatever somebody typed, and its bar has room for a line of it. */
const escapeText = (text: string, room: number): string => escapeXml(text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text);

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * One frame of the film, written to `path`: the picture, the second camera
 * beside it where there is one, and the overlay layer on top. Every frame comes
 * out at the same size, because ffmpeg is fed a numbered sequence and a frame of
 * another size ends the film there - which is also why a side that has no
 * picture at this instant stays black rather than making the other one wider.
 */
export const composeFrame = async (
  pictures: readonly (Buffer | null)[],
  size: FrameSize,
  layer: (frame: OverlayFrame) => string | null,
  at: Date,
  path: string,
): Promise<void> => {
  const column = even(Math.floor(size.width / Math.max(pictures.length, 1)));

  const tiles = await Promise.all(
    pictures.map(async (picture, index) =>
      picture === null
        ? null
        : { input: await sharp(picture).resize(column, size.height, { fit: 'cover', position: 'centre' }).toBuffer(), left: index * column, top: 0 },
    ),
  );

  const overlay = layer({ at, width: size.width, height: size.height });

  await sharp({ create: { width: size.width, height: size.height, channels: 3, background: '#000000' } })
    .composite([...tiles.filter(tile => tile !== null), ...(overlay ? [{ input: Buffer.from(overlay), left: 0, top: 0 }] : [])])
    .jpeg({ quality: 90 })
    .toFile(path);
};
