jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const execFileCalls: string[][] = [];

jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, callback: (e: Error | null, out: Buffer, err: string) => void) => {
    execFileCalls.push(args);
    callback(null, Buffer.alloc(0), '');
  },
}));

const filesWritten: string[] = [];

jest.mock('node:fs/promises', () => ({
  mkdtemp: () => Promise.resolve('/tmp/timelapse-test'),
  writeFile: (path: string) => {
    filesWritten.push(path);
    return Promise.resolve();
  },
  readFile: () => Promise.resolve(Buffer.alloc(0)),
  unlink: () => Promise.resolve(),
  rmdir: () => Promise.resolve(),
}));

const store = {
  uploaded: [] as { imageId: string; bytes: number }[],
  uploadedFiles: [] as { imageId: string; path: string }[],
  copiedToFile: [] as { imageId: string; path: string }[],
  deleted: [] as string[],
};

jest.mock('@/databases/imagestore', () => ({
  imageStore: {
    upload: (imageId: string, data: Buffer) => {
      store.uploaded.push({ imageId, bytes: data.length });
      return Promise.resolve();
    },
    uploadFile: (imageId: string, path: string) => {
      store.uploadedFiles.push({ imageId, path });
      return Promise.resolve(4_242_424);
    },
    copyToFile: (imageId: string, path: string) => {
      store.copiedToFile.push({ imageId, path });
      return Promise.resolve();
    },
    delete: (imageIds: string[]) => {
      store.deleted.push(...imageIds);
      return Promise.resolve();
    },
  },
}));

import { imageService } from '@services/image.service';
import imageModel from '@models/images.model';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;
const FRAME_INTERVAL_MS = 2 * 60 * 1000;
const DEVICE = { device_id: 'device-1' } as any;

const PERIOD_END = 1_700_006_400_000;
const PERIOD_START = PERIOD_END - MS_IN_A_DAY;

const frames = Array.from({ length: 600 }, (_, i) => ({
  image_id: `frame-${i}`,
  timestamp: PERIOD_START + i * FRAME_INTERVAL_MS,
}));

/** Mongoose query results are awaited both directly and after .select(). */
const thenable = (value: unknown) => ({
  select: () => Promise.resolve(value),
  then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
});

const compressDay = (existingTimelapse: unknown = null) => {
  imageModel.findOne = jest.fn().mockImplementation((filter: any) => {
    if (filter.format === 'mp4') {
      return thenable(existingTimelapse);
    }
    // No inline payload: everything but the legacy fixtures lives in the store.
    return thenable(null);
  }) as any;

  return (imageService as any).compressRtspStreamRange(DEVICE, MS_IN_A_DAY, FRAME_INTERVAL_MS, '1d', 60 * 60 * 1000);
};

const ffmpegArg = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('pictures are kept in the image store, not in their document', () => {
  beforeEach(() => {
    execFileCalls.length = 0;
    filesWritten.length = 0;
    store.uploaded.length = 0;
    store.uploadedFiles.length = 0;
    store.copiedToFile.length = 0;
    store.deleted.length = 0;

    jest.spyOn(Date, 'now').mockReturnValue(PERIOD_END);

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

  it('encodes the timelapse at full quality, with no size-driven scaling or rate cap', async () => {
    await compressDay();

    const encode = execFileCalls[0];
    expect(ffmpegArg(encode, '-crf')).toBe('30');
    expect(encode).not.toContain('-vf');
    expect(encode).not.toContain('-maxrate');
  });

  it('hands the finished video to the store as a file, never as a buffer', async () => {
    await compressDay();

    expect(store.uploadedFiles).toEqual([{ imageId: 'test-uuid', path: '/tmp/timelapse-test/result.mp4' }]);
    expect(store.uploaded).toEqual([]);
  });

  it('records the size on the document and stores no bytes in it', async () => {
    await compressDay();

    const written = (imageModel.create as jest.Mock).mock.calls[0][0];
    expect(written).toMatchObject({ image_id: 'test-uuid', format: 'mp4', duration: '1d', size: 4_242_424 });
    expect(written.data).toBeUndefined();
  });

  it('copies the frames out of the store instead of loading them into memory', async () => {
    await compressDay();

    expect(store.copiedToFile).toHaveLength(600);
    expect(store.copiedToFile[0]).toEqual({ imageId: 'frame-0', path: '/tmp/timelapse-test/1.jpeg' });
    expect(filesWritten).toEqual([]);
  });

  it('deletes the timelapse it replaces, so its bytes go with the document', async () => {
    await compressDay({ image_id: 'previous-timelapse', timestampEnd: PERIOD_START });

    expect(imageModel.deleteOne).toHaveBeenCalledWith({ image_id: 'previous-timelapse' });
  });

  it('drops the bytes again when the document cannot be written', async () => {
    imageModel.create = jest.fn().mockRejectedValue(new Error('duplicate key')) as any;

    await compressDay();

    expect(store.deleted).toEqual(['test-uuid']);
  });
});
