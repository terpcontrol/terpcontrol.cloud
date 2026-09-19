import { FastifyRequest } from 'fastify';
import { LinkCard } from '@fg2/shared-types/v1';
import { Grant } from '@common/v1/access.types';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { baseUrlOf, shellHtml } from '@modules/v1/sharing/link-card';
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

  it('keeps back a photo somebody logged against another grow', () => {
    expect(belongsToGrow(grow(), grant(), picture({ cameraId: null, growId: 'grow-somebody-else' }), null, null)).toBe(false);
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
  const request = { protocol: 'https', hostname: 'reached.example', headers: { host: 'reached.example' } } as unknown as FastifyRequest;

  it('is the address this install publishes, because that is what every other client is told to call', () => {
    expect(baseUrlOf(request, 'https://published.example')).toBe('https://published.example');
    // A trailing slash would double up in every URL built from it.
    expect(baseUrlOf(request, 'https://published.example/')).toBe('https://published.example');
  });

  it('falls back to the host the request arrived on, which is what a crawler followed to get here', () => {
    expect(baseUrlOf(request, undefined)).toBe('https://reached.example');
    expect(baseUrlOf(request, '   ')).toBe('https://reached.example');
  });
});
