import { LinkCard } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CardCache, baseUrlOf, shellHtml } from '@modules/v1/sharing/link-card';
import { belongsToGrow } from '@modules/v1/sharing/public-pages.service';

/**
 * The two decisions a public page makes that nothing else in the server makes.
 *
 * Which pictures a public diary lets out is the first: a still belongs to a
 * camera rather than to a grow, so what makes one readable by a stranger is the
 * grow it was taken in - a rule with four ways to be wrong, each of which hands
 * a picture to somebody it was never shown to. It is a function of the row, the
 * grant and two lookups, so it is asked here directly rather than through a
 * route that would have to arrange a camera to ask it about.
 *
 * The second is the shell: it puts a diary's name, which is whatever somebody
 * typed, into markup.
 */

const TENT = 'space-tent';
const FRIDGE = 'space-fridge';

const MAY = new Date('2026-05-01T00:00:00.000Z');
const JUNE = new Date('2026-06-01T00:00:00.000Z');
const JULY = new Date('2026-07-01T00:00:00.000Z');

/** A grow that stood in the tent through May and moved to the fridge in June. */
const grow = (over: Partial<GrowDocument> = {}): GrowDocument =>
  ({
    id: 'grow-1',
    ownerId: 'user-owner',
    name: 'Spring run',
    slug: 'spring-run',
    coverMediaId: 'media-cover',
    filmMediaId: 'media-film',
    startedAt: MAY,
    endedAt: null,
    placements: [
      { id: 'placement-tent', spaceId: TENT, startedAt: MAY, endedAt: JUNE, plantIds: null },
      { id: 'placement-fridge', spaceId: FRIDGE, startedAt: JUNE, endedAt: null, plantIds: null },
    ],
    ...over,
  }) as unknown as GrowDocument;

const picture = (over: Partial<MediaDocument> = {}): MediaDocument =>
  ({
    id: 'media-1',
    kind: 'still',
    mime: 'image/jpeg',
    cameraId: 'camera-1',
    growId: null,
    spaceId: null,
    capturedAt: new Date('2026-05-15T12:00:00.000Z'),
    endsAt: null,
    ...over,
  }) as unknown as MediaDocument;

const grant = (over: Partial<Grant> = {}): Grant => ({
  need: 'view',
  subject: { type: 'grow', id: 'grow-1' },
  grantee: 'public',
  range: { startsAt: MAY, endsAt: JULY },
  privacyOwnerId: 'user-owner',
  redacted: true,
  includeCameras: true,
  ...over,
});

describe('which pictures a public diary lets out', () => {
  it('lets out what the page itself draws: the cover, the film, a photo of the grow and the author´s face', () => {
    const open = grant();

    expect(belongsToGrow(grow(), open, picture({ id: 'media-cover', cameraId: null }), null, null)).toBe(true);
    expect(belongsToGrow(grow(), open, picture({ id: 'media-film', cameraId: null }), null, null)).toBe(true);
    expect(belongsToGrow(grow(), open, picture({ id: 'media-photo', cameraId: null, growId: 'grow-1' }), null, null)).toBe(true);
    expect(belongsToGrow(grow(), open, picture({ id: 'media-avatar', cameraId: null }), 'media-avatar', null)).toBe(true);
  });

  it('lets out a still of the camera that was watching where the plants stood', () => {
    expect(belongsToGrow(grow(), grant(), picture({ capturedAt: new Date('2026-05-15T12:00:00.000Z') }), null, TENT)).toBe(true);
    expect(belongsToGrow(grow(), grant(), picture({ capturedAt: new Date('2026-06-15T12:00:00.000Z') }), null, FRIDGE)).toBe(true);
  });

  it('keeps back a still of the same camera from before the plants arrived or after they left', () => {
    // The tent held this grow in May and somebody else's in June; the camera did
    // not move, and neither did its pictures.
    expect(belongsToGrow(grow(), grant(), picture({ capturedAt: new Date('2026-06-15T12:00:00.000Z') }), null, TENT)).toBe(false);
    expect(belongsToGrow(grow(), grant(), picture({ capturedAt: new Date('2026-05-15T12:00:00.000Z') }), null, FRIDGE)).toBe(false);
  });

  it('keeps back a still of a place the grow never stood in, and one of a camera that stands nowhere', () => {
    expect(belongsToGrow(grow(), grant(), picture(), null, 'space-somewhere-else')).toBe(false);
    expect(belongsToGrow(grow(), grant(), picture(), null, null)).toBe(false);
  });

  it('keeps back every still where the link was not made to carry them', () => {
    const closed = grant({ includeCameras: false });

    expect(belongsToGrow(grow(), closed, picture(), null, TENT)).toBe(false);
    // The page's own pictures are not the camera's and still come through.
    expect(belongsToGrow(grow(), closed, picture({ id: 'media-cover', cameraId: null }), null, null)).toBe(true);
  });

  it('keeps back a still taken outside the window the reader was given', () => {
    const narrow = grant({ range: { startsAt: MAY, endsAt: new Date('2026-05-10T00:00:00.000Z') } });

    expect(belongsToGrow(grow(), narrow, picture({ capturedAt: new Date('2026-05-05T12:00:00.000Z') }), null, TENT)).toBe(true);
    expect(belongsToGrow(grow(), narrow, picture({ capturedAt: new Date('2026-05-15T12:00:00.000Z') }), null, TENT)).toBe(false);
  });

  /**
   * A film is dated by its first frame and runs on for a day or a week after
   * it. One that begins on the window's last day, or right at its end, is days
   * of footage the reader was not sent - on a grow that has ended, the tent
   * after the harvest with the next grow in it.
   */
  it('keeps back a film that begins inside the window and runs on past it', () => {
    const narrow = grant({ range: { startsAt: MAY, endsAt: new Date('2026-05-10T00:00:00.000Z') } });
    const film = (capturedAt: string, endsAt: string): MediaDocument =>
      picture({ kind: 'timelapse', capturedAt: new Date(capturedAt), endsAt: new Date(endsAt) });

    expect(belongsToGrow(grow(), narrow, film('2026-05-03T00:00:00.000Z', '2026-05-09T23:59:00.000Z'), null, TENT)).toBe(true);
    expect(belongsToGrow(grow(), narrow, film('2026-05-08T00:00:00.000Z', '2026-05-14T23:59:00.000Z'), null, TENT)).toBe(false);
    expect(belongsToGrow(grow(), narrow, film('2026-05-10T00:00:00.000Z', '2026-05-10T23:59:00.000Z'), null, TENT)).toBe(false);
  });

  it('keeps back a photo somebody logged against another grow', () => {
    expect(belongsToGrow(grow(), grant(), picture({ cameraId: null, growId: 'grow-somebody-else' }), null, null)).toBe(false);
  });

  /**
   * A photo hangs off a diary line, and a diary line has a day on it and is
   * clamped to the window like every other. Letting the photo through because it
   * names the grow would hand a reader sent one fortnight the photographs of the
   * whole run, one id at a time.
   */
  it('keeps back a photo of this very grow taken outside the window the reader was given', () => {
    const narrow = grant({ range: { startsAt: MAY, endsAt: new Date('2026-05-10T00:00:00.000Z') } });
    const photo = (capturedAt: Date): MediaDocument => picture({ id: 'media-photo', kind: 'photo', cameraId: null, growId: 'grow-1', capturedAt });

    expect(belongsToGrow(grow(), narrow, photo(new Date('2026-05-05T12:00:00.000Z')), null, null)).toBe(true);
    expect(belongsToGrow(grow(), narrow, photo(new Date('2026-05-15T12:00:00.000Z')), null, null)).toBe(false);
  });

  /**
   * What the window does not date is what the page is told under: the grow names
   * its cover and its film, and the byline names the face beside it. A reader
   * holding the page holds those whatever fortnight they were sent.
   */
  it('still lets out the cover, the film and the author´s face from outside the window', () => {
    const narrow = grant({ range: { startsAt: MAY, endsAt: new Date('2026-05-10T00:00:00.000Z') } });
    const late = new Date('2026-06-15T12:00:00.000Z');

    expect(belongsToGrow(grow(), narrow, picture({ id: 'media-cover', kind: 'photo', cameraId: null, capturedAt: late }), null, null)).toBe(true);
    expect(belongsToGrow(grow(), narrow, picture({ id: 'media-film', cameraId: null, capturedAt: late }), null, null)).toBe(true);
    expect(
      belongsToGrow(grow(), narrow, picture({ id: 'media-avatar', kind: 'avatar', cameraId: null, capturedAt: late }), 'media-avatar', null),
    ).toBe(true);
  });
});

describe('the shell a crawler reads', () => {
  const card = (over: Partial<LinkCard> = {}): LinkCard => ({
    title: 'Spring run',
    description: 'A grow diary by @mia, on day 34 of flowering.',
    pageUrl: 'https://api.example/g/spring-run',
    imageUrl: 'https://api.example/v1/public/grows/spring-run/card.png',
    handle: 'mia',
    dayNumber: 34,
    stage: 'flowering',
    ...over,
  });

  it('says the same thing in its tags as the picture it points at', () => {
    const html = shellHtml(card());

    expect(html).toContain('<meta property="og:title" content="Spring run">');
    expect(html).toContain('<meta property="og:image" content="https://api.example/v1/public/grows/spring-run/card.png">');
    expect(html).toContain('<meta property="og:url" content="https://api.example/g/spring-run">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('escapes a name somebody typed rather than putting it into the markup', () => {
    const html = shellHtml(card({ title: '"><script>alert(1)</script>', description: "Mia's tent & a fridge" }));

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('content=""><');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Mia&#39;s tent &amp; a fridge');
  });
});

describe('where the absolute URLs on a card come from', () => {
  it('is the address this install publishes, because that is what every other client is told to call', () => {
    expect(baseUrlOf('https://published.example')).toBe('https://published.example');
    // A trailing slash would double up in every URL built from it.
    expect(baseUrlOf('https://published.example/')).toBe('https://published.example');
  });

  /**
   * It used to fall back to the `Host` header of the request that arrived,
   * which is written by whoever made it: on an install that had never set the
   * variable, a chosen `Host` put an attacker's address into the `canonical`,
   * the `og:url` and the `og:image` of every public diary and of every card a
   * chat window drew from them.
   */
  it('is never taken from the request, whatever the request says', () => {
    expect(() => baseUrlOf(undefined)).toThrow(/API_URL_EXTERNAL/);
    expect(() => baseUrlOf('   ')).toThrow(/API_URL_EXTERNAL/);
  });
});

describe('the cards kept in memory', () => {
  const png = (name: string): Buffer => Buffer.from(name);

  it('draws one card once, however many readers open the link at the same time', async () => {
    const cache = new CardCache();
    let drawn = 0;
    const draw = async (): Promise<Buffer> => {
      drawn += 1;
      return png('card');
    };

    const [first, second] = await Promise.all([cache.of('grow:1', draw), cache.of('grow:1', draw)]);
    const later = await cache.of('grow:1', draw);

    expect(drawn).toBe(1);
    expect(first).toEqual(png('card'));
    expect(second).toEqual(png('card'));
    expect(later).toEqual(png('card'));
  });

  it('keeps one card per address, and keeps no failure at all', async () => {
    const cache = new CardCache();

    await expect(cache.of('grow:1', () => Promise.reject(new Error('no cover')))).rejects.toThrow('no cover');

    // The next reader of the same address is drawn rather than handed the
    // failure the first one got.
    expect(await cache.of('grow:1', () => Promise.resolve(png('second try')))).toEqual(png('second try'));
    expect(await cache.of('grow:2', () => Promise.resolve(png('another')))).toEqual(png('another'));
  });
});
