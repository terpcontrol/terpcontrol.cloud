import sharp from 'sharp';
import { Injectable } from '@nestjs/common';
import { LinkCard } from '@fg2/shared-types/v1';
import { FIGURE_FAMILY, INK, MUTED, PANEL, TEXT_FAMILY, escapeXml } from '@modules/v1/camera/timelapse-overlays';

/**
 * What a shared address looks like everywhere but in the app: the picture a
 * chat window draws, and the few lines of HTML a crawler reads.
 *
 * Both are made from the same `LinkCard`, so the tags and the picture cannot say
 * different things - which is the whole reason the shape exists. The picture is
 * drawn the way a film's overlays are: one SVG layer composited by sharp, which
 * needs no font files in the container and no second dependency.
 */

/** What every scraper expects of an Open Graph image, and what they all crop to. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * How long a card and a shell may be held on to, by this server and by whatever
 * is between it and a reader.
 *
 * **The trade.** A public diary goes private the instant its grower says so, and
 * the origin stops answering at once - but a `public` answer that is already in
 * a shared cache is out of reach until it expires. So the duration is the window
 * in which a diary that has been taken down can still be fetched by somebody who
 * never held a link, and it is chosen to be short enough to be honest about
 * rather than long enough to be free. Five minutes for the picture, two for the
 * page whose title states a day number that moves daily.
 *
 * What it costs is re-rendering a busy link a few times an hour instead of once,
 * and `CardCache` below absorbs that: the extra fetches cost a request each and
 * not a render.
 */
export const CARD_CACHE_SECONDS = 300;
export const SHELL_CACHE_SECONDS = 120;

const MARGIN = 72;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2;

const TITLE_SIZE = 64;
const META_SIZE = 30;
const DESCRIPTION_SIZE = 28;

/**
 * Roughly how wide a character is as a share of the type size. The container
 * has no font metrics to measure with and the families are a fallback chain
 * anyway, so a line is broken by an estimate - generous enough that a line of
 * capitals still fits inside the margins.
 */
const CHARACTER_WIDTH = 0.55;

const charactersPerLine = (size: number): number => Math.floor(CONTENT_WIDTH / (size * CHARACTER_WIDTH));

/**
 * Greedy wrapping, then a hard cut: a name somebody typed can be a paragraph,
 * and a card has room for what a card has room for.
 */
const wrap = (text: string, size: number, lines: number): string[] => {
  const width = charactersPerLine(size);
  const wrapped: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width || current === '') {
      current = candidate.slice(0, width);
      continue;
    }

    wrapped.push(current);
    if (wrapped.length === lines) return wrapped;
    current = word.slice(0, width);
  }

  if (current) wrapped.push(current);
  return wrapped.slice(0, lines);
};

/** "@mia · Day 34 · Flowering" - whichever of the three the card has. */
const metaLineOf = (card: LinkCard): string =>
  [card.handle ? `@${card.handle}` : null, card.dayNumber === null ? null : `Day ${card.dayNumber}`, card.stage]
    .filter((part): part is string => part !== null)
    .join('  ·  ');

const textLayer = (card: LinkCard, hasCover: boolean): string => {
  const title = wrap(card.title, TITLE_SIZE, 2);
  const description = wrap(card.description, DESCRIPTION_SIZE, 2);
  const meta = metaLineOf(card);

  // A cover keeps its picture and gets a scrim dark enough to read white type
  // over; a grow with no cover yet gets the app's own panel colour instead of a
  // blank rectangle.
  const backdrop = hasCover
    ? `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#scrim)"/>`
    : `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${PANEL}"/>`;

  const titleTop = CARD_HEIGHT - MARGIN - (description.length + 1) * (DESCRIPTION_SIZE + 12) - title.length * (TITLE_SIZE + 10);

  const titleLines = title
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${titleTop + (index + 1) * (TITLE_SIZE + 10)}" font-family="${TEXT_FAMILY}" font-size="${TITLE_SIZE}"
               font-weight="600" fill="${INK}">${escapeXml(line)}</text>`,
    )
    .join('');

  const descriptionTop = titleTop + title.length * (TITLE_SIZE + 10) + 16;
  const descriptionLines = description
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${descriptionTop + (index + 1) * (DESCRIPTION_SIZE + 12)}" font-family="${TEXT_FAMILY}"
               font-size="${DESCRIPTION_SIZE}" fill="${MUTED}">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${PANEL}" stop-opacity="0.15"/>
        <stop offset="55%" stop-color="${PANEL}" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="${PANEL}" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    ${backdrop}
    ${meta ? `<text x="${MARGIN}" y="${MARGIN + META_SIZE}" font-family="${FIGURE_FAMILY}" font-size="${META_SIZE}" fill="${MUTED}">${escapeXml(meta)}</text>` : ''}
    ${titleLines}
    ${descriptionLines}
  </svg>`;
};

/**
 * The card itself. The cover is composited underneath rather than drawn into the
 * SVG, because an SVG cannot carry a JPEG without embedding it as base64 - which
 * would make the layer as large as the picture.
 */
export const renderCard = async (card: LinkCard, cover: Buffer | null): Promise<Buffer> => {
  const tile = cover
    ? await sharp(cover)
        .rotate()
        .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
        .toBuffer()
        .catch(() => null)
    : null;

  return sharp({ create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...(tile ? [{ input: tile, left: 0, top: 0 }] : []), { input: Buffer.from(textLayer(card, tile !== null)), left: 0, top: 0 }])
    .png()
    .toBuffer();
};

/**
 * How long a rendered card is kept, which is also how long it is served with.
 *
 * Nothing about a card is per-reader, and drawing one costs a read of the grow
 * and its plants, the cover's bytes out of the bucket and a 1200x630 composite
 * through sharp - while a link pasted into a channel with two hundred people in
 * it is two hundred requests for the same picture inside a minute. What is kept
 * is the in-flight promise rather than the bytes, so a burst that arrives before
 * the first render finishes waits for it instead of starting a second.
 *
 * In memory, like the rate limiter and for the same reason: the server is
 * deployed as one process. The map is swept as it is read, so it holds what has
 * been asked for lately rather than every diary ever shared.
 */
const CARD_TTL_MS = CARD_CACHE_SECONDS * 1000;

/** A safety net rather than a policy: a sweep only runs on a read, and a burst of unique addresses must not grow the map without bound. */
const MOST_CARDS_KEPT = 200;

@Injectable()
export class CardCache {
  private readonly rendered = new Map<string, { png: Promise<Buffer>; until: number }>();

  public async of(key: string, draw: () => Promise<Buffer>): Promise<Buffer> {
    const now = Date.now();
    this.sweep(now);

    const known = this.rendered.get(key);
    if (known && known.until > now) return known.png;

    const png = draw();
    this.rendered.set(key, { png, until: now + CARD_TTL_MS });
    // A render that failed is not an answer worth keeping for five minutes, and
    // the rejection still reaches the caller that asked for it.
    png.catch(() => this.rendered.delete(key));

    return png;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.rendered) {
      if (entry.until <= now) this.rendered.delete(key);
    }

    // Oldest first, which is insertion order: what is left is all unexpired, so
    // there is nothing better to drop than what was asked for longest ago.
    while (this.rendered.size > MOST_CARDS_KEPT) this.rendered.delete(this.rendered.keys().next().value!);
  }
}

/** Text being put into an HTML attribute, which is the same escaping an XML one needs plus the apostrophe. */
const escapeHtml = (text: string): string => escapeXml(text).replace(/'/g, '&#39;');

/**
 * The shell a crawler, a chat window and anybody who opened the address before
 * the app loaded gets. It is deliberately small: the tags are the point, and the
 * body is there so that a person who follows the link sees the diary's name and
 * its picture rather than a blank page.
 */
export const shellHtml = (card: LinkCard): string => {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const pageUrl = escapeHtml(card.pageUrl);
  const imageUrl = escapeHtml(card.imageUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Terp Control">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="${CARD_WIDTH}">
<meta property="og:image:height" content="${CARD_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${imageUrl}">
</head>
<body>
<main>
<h1>${title}</h1>
<p>${description}</p>
<p><img src="${imageUrl}" alt="${title}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}"></p>
<p><a href="${pageUrl}">${pageUrl}</a></p>
</main>
</body>
</html>
`;
};

/**
 * The page an address that leads nowhere answers: a diary that went private,
 * a profile that was switched off, a slug somebody mistyped. It is opened by a
 * person in a browser as often as by a crawler, so it is a page and not the
 * JSON refusal the API routes answer - and it says as much as the app's own
 * page for the same address, and no more.
 */
export const missingHtml = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>
`;

/**
 * What the absolute URLs on a card are built from: the address this install
 * publishes, which is what every other client is told to call and what the API
 * document names.
 *
 * It is required rather than guessed. A card is the one answer here that states
 * an address instead of following one, and the `Host` header is written by
 * whoever made the request - so falling back to it let a crawler be sent a
 * `canonical` and an `og:image` pointing at somebody else's server, on an
 * install that had simply never set the variable. `validateEnvironment` refuses
 * to start without it, so this cannot be reached in a running server; it throws
 * rather than returning nothing, because a card with a half-built address is
 * worse than no card.
 */
export const baseUrlOf = (configured: string | undefined): string => {
  const published = (configured ?? '').trim().replace(/\/+$/, '');
  if (!published) throw new Error('API_URL_EXTERNAL is not set, so no address can be published for a share card.');

  return published;
};
