jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, callback: (e: Error | null, out: Buffer, err: string) => void) => {
    callback(null, Buffer.alloc(0), '');
  },
}));

jest.mock('node:fs/promises', () => ({
  mkdtemp: () => Promise.resolve('/tmp/timelapse-test'),
  writeFile: () => Promise.resolve(),
  readFile: () => Promise.resolve(Buffer.alloc(0)),
  unlink: () => Promise.resolve(),
  rmdir: () => Promise.resolve(),
}));

jest.mock('@/databases/imagestore', () => ({
  imageStore: {
    upload: () => Promise.resolve(),
    uploadFile: () => Promise.resolve(4_242_424),
    copyToFile: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  },
}));

import { imageService } from '@services/image.service';
import imageModel from '@models/images.model';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;
const FRAME_INTERVAL_MS = 2 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const DEVICE = { device_id: 'device-1' } as any;

const PERIOD_END = 1_700_006_400_000;

// Stills on the current day and on days 1, 2, 4 and 5 back. Day 3 is silent -
// the device was off, or the camera was unreachable for a whole day.
const DAYS_WITH_FRAMES = [0, 1, 2, 4, 5];
const SILENT_DAY = 3;

const frames = DAYS_WITH_FRAMES.flatMap(day => {
  const periodStart = PERIOD_END - (day + 1) * MS_IN_A_DAY;
  return Array.from({ length: 15 }, (_, i) => ({
    image_id: `frame-${day}-${i}`,
    timestamp: periodStart + i * FRAME_INTERVAL_MS,
    // Store-backed, so reading a frame costs no second query for inline bytes.
    size: 1024,
  }));
});

/** Mongoose query results are awaited both directly and after .select(). */
const thenable = (value: unknown) => ({
  select: () => Promise.resolve(value),
  then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
});

/** Which day back a written timelapse covers, counting 0 as the current one. */
const daysBackOf = (timestamp: number) => Math.round((PERIOD_END - MS_IN_A_DAY - timestamp) / MS_IN_A_DAY);

const walk = (backfillUntil?: number) =>
  (imageService as any).compressRtspStreamRange(DEVICE, MS_IN_A_DAY, FRAME_INTERVAL_MS, '1d', REFRESH_INTERVAL_MS, backfillUntil);

const daysBuilt = () => (imageModel.create as jest.Mock).mock.calls.map(call => daysBackOf(call[0].timestamp));

describe('walking back over periods that need no timelapse', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(PERIOD_END);

    // Nothing has been compressed yet, so every period with frames is due.
    imageModel.findOne = jest.fn().mockImplementation(() => thenable(null)) as any;

    imageModel.find = jest.fn().mockImplementation((filter: any) => {
      const matched = frames
        .filter(frame => frame.timestamp < Number(filter.timestamp.$lt) && frame.timestamp >= Number(filter.timestamp.$gte))
        .sort((a, b) => b.timestamp - a.timestamp);
      return { sort: () => ({ select: () => ({ limit: (n: number) => Promise.resolve(matched.slice(0, n)) }) }) };
    }) as any;

    imageModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 }) as any;
    imageModel.create = jest.fn().mockImplementation((doc: unknown) => Promise.resolve(doc)) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stops at the first silent day when it is not backfilling', async () => {
    await walk();

    expect(daysBuilt()).toEqual([0, 1, 2]);
  });

  it('steps over the silent day during the catch-up sweep and reaches the days behind it', async () => {
    await walk(PERIOD_END - 30 * MS_IN_A_DAY);

    expect(daysBuilt()).toEqual(DAYS_WITH_FRAMES);
    expect(daysBuilt()).not.toContain(SILENT_DAY);
  });

  it('gives up at the edge of the backfill window rather than walking back forever', async () => {
    await walk(PERIOD_END - 30 * MS_IN_A_DAY);

    // One lookup per period examined: the 30 inside the window, and not one past it.
    const periodsExamined = (imageModel.findOne as jest.Mock).mock.calls.filter(call => call[0].format === 'mp4');
    expect(periodsExamined).toHaveLength(30);
  });

  it('does not rebuild a period whose timelapse already covers its newest frame', async () => {
    const upToDate = { image_id: 'existing', timestampEnd: PERIOD_END - MS_IN_A_DAY + 14 * FRAME_INTERVAL_MS };
    imageModel.findOne = jest.fn().mockImplementation((filter: any) => {
      // Only day 1 back has one; the sweep has to carry on past it regardless.
      return thenable(filter.timestamp === PERIOD_END - 2 * MS_IN_A_DAY ? upToDate : null);
    }) as any;

    await walk(PERIOD_END - 30 * MS_IN_A_DAY);

    expect(daysBuilt()).toEqual([0, 2, 4, 5]);
  });
});
