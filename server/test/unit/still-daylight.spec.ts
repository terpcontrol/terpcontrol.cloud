import { daylightOf, stillSpeaksForMs, StillDaylightService, type SeenStill } from '@modules/v1/camera/still-daylight.service';
import { useV1TestDatabase } from './support/v1-database';

/**
 * A camera tells the day from the night by its stills: once a tent goes dark
 * it switches to its night mode and sends grey. Each still is measured once,
 * when it is stored, and a smart plug that keeps no schedule of its own takes
 * its VPD's day and night from the newest still of a camera where it stands.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('how long a still speaks for its camera', () => {
  const camera = { stillIntervalSeconds: 30 };

  it('is ten of its intervals while fresh, until the camera counts as stopped', () => {
    expect(stillSpeaksForMs(camera, 0)).toBe(5 * MINUTE);
    expect(stillSpeaksForMs({ stillIntervalSeconds: 60 }, HOUR)).toBe(10 * MINUTE);
  });

  it('adds the gap thinning has left by the still´s age', () => {
    expect(stillSpeaksForMs(camera, 2 * DAY)).toBe(6 * MINUTE);
    expect(stillSpeaksForMs(camera, 8 * DAY)).toBe(10 * MINUTE);
    expect(stillSpeaksForMs(camera, 31 * DAY)).toBe(20 * MINUTE);
    expect(stillSpeaksForMs(camera, 100 * DAY)).toBe(65 * MINUTE);
  });
});

describe('what the stills of a place say of an instant', () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const cameras = [
    { id: 'cam-a', stillIntervalSeconds: 30 },
    { id: 'cam-b', stillIntervalSeconds: 30 },
  ];
  const still = (cameraId: string, at: number, monochrome: boolean): SeenStill => ({ cameraId, at, monochrome });

  it('is day where the newest still is in colour and night where it is grey', () => {
    const dayAt = daylightOf([still('cam-a', now - 10 * MINUTE, true), still('cam-a', now - 2 * MINUTE, false)], cameras, now);

    expect(dayAt(now)).toBe(true);
    expect(dayAt(now - 5 * MINUTE)).toBe(false);
  });

  it('goes by the newest still of any camera, and never by one taken after the instant', () => {
    const dayAt = daylightOf([still('cam-a', now - 3 * MINUTE, false), still('cam-b', now - MINUTE, true)], cameras, now);

    expect(dayAt(now)).toBe(false);
    expect(dayAt(now - 2 * MINUTE)).toBe(true);
    expect(dayAt(now - 4 * MINUTE)).toBeNull();
  });

  it('says nothing once the newest still no longer speaks for its camera', () => {
    const dayAt = daylightOf([still('cam-a', now - 6 * MINUTE, false)], cameras, now);

    expect(dayAt(now - MINUTE)).toBe(true);
    expect(dayAt(now)).toBeNull();
  });

  it('reaches over the gap thinning left in the past', () => {
    // A month ago one still in fifteen minutes is kept.
    const past = now - 40 * DAY;
    const dayAt = daylightOf([still('cam-a', past, true), still('cam-a', past + 15 * MINUTE, false)], cameras, now);

    expect(dayAt(past + 14 * MINUTE)).toBe(false);
    expect(dayAt(past + 29 * MINUTE)).toBe(true);
    expect(dayAt(past + 36 * MINUTE)).toBeNull();
  });

  it('ignores the stills of a camera that is not in the place', () => {
    expect(daylightOf([still('cam-elsewhere', now - MINUTE, false)], cameras, now)(now)).toBeNull();
  });
});

describe('the stills of a space, as the store reads them', () => {
  const db = useV1TestDatabase();
  const SPACE = 'space-1';

  const camera = (id: string, spaceId: string, over: Record<string, unknown> = {}) =>
    db.cameras.create({ id, ownerId: 'user-1', kind: 'rtsp', name: id, spaceId, ...over });

  const stored = (id: string, cameraId: string, capturedAt: Date, monochrome?: boolean | null) =>
    db.media.create({ id, kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId, capturedAt, ...(monochrome === undefined ? {} : { monochrome }) });

  /** What the store answers of the space at one instant, as a live reading asks. */
  const readAt = (now: number) =>
    new StillDaylightService(db.cameras, db.media).dayIn(SPACE, { startsAt: new Date(now), endsAt: new Date(now), stepSeconds: 1 });

  beforeEach(() => db.reset());

  it('answers each instant from the newest still of the space´s cameras, removed ones included', async () => {
    const now = Date.now();
    await camera('cam-1', SPACE);
    await camera('cam-2', SPACE, { removedAt: new Date(now - HOUR) });
    await camera('cam-3', 'space-2');
    await stored('s1', 'cam-1', new Date(now - 4 * MINUTE), true);
    await stored('s2', 'cam-2', new Date(now - 3 * MINUTE), false);
    await stored('s3', 'cam-3', new Date(now - MINUTE), true);

    const dayAt = await readAt(now);

    expect(dayAt(now)).toBe(true);
    expect(dayAt(now - 3.5 * MINUTE)).toBe(false);
  });

  it('takes a still kept before its colour was measured for unknown', async () => {
    const now = Date.now();
    await camera('cam-1', SPACE);
    await stored('measured', 'cam-1', new Date(now - 4 * MINUTE), true);
    await stored('unread', 'cam-1', new Date(now - 2 * MINUTE), null);
    await db.media.collection.insertOne({
      id: 'before',
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      cameraId: 'cam-1',
      capturedAt: new Date(now - MINUTE),
    });

    const dayAt = await readAt(now);

    // The newest still that says anything is the grey one four minutes ago.
    expect(dayAt(now)).toBe(false);
  });

  it('answers the middle of every window of a series by the newest still before it', async () => {
    // Windows of ten minutes from 10:00; the lamp goes out at 10:12, and the
    // camera turns grey with the still after it.
    const step = 600;
    const from = Date.parse('2026-10-08T10:00:00.000Z');
    await camera('cam-1', SPACE);
    for (let at = from - 5 * MINUTE; at < from + 30 * MINUTE; at += MINUTE / 2) {
      await stored(`s-${at}`, 'cam-1', new Date(at), at > from + 12 * MINUTE);
    }

    const dayAt = await new StillDaylightService(db.cameras, db.media).dayIn(SPACE, {
      startsAt: new Date(from),
      endsAt: new Date(from + 30 * MINUTE),
      stepSeconds: step,
    });

    expect([5, 15, 25].map(minute => dayAt(from + minute * MINUTE))).toEqual([true, false, false]);
    // Between the middles it is a still from before the instant, if not always the newest.
    expect(dayAt(from + 11 * MINUTE)).toBe(true);
  });

  it('says nothing where the space has no camera', async () => {
    const now = Date.now();
    await camera('cam-3', 'space-2');
    await stored('s3', 'cam-3', new Date(now - MINUTE), false);

    const dayAt = await readAt(now);

    expect(dayAt(now)).toBeNull();
  });
});
