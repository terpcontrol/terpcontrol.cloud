const storedFiles = new Map<string, number>();

jest.mock('@/databases/imagestore', () => ({
  imageStore: {
    listFileIds: (uploadedBefore: number) => ({
      async *[Symbol.asyncIterator]() {
        for (const [imageId, uploadedAt] of [...storedFiles.entries()]) {
          if (uploadedAt < uploadedBefore) {
            yield imageId;
          }
        }
      },
    }),
    delete: (imageIds: string[]) => {
      imageIds.forEach(imageId => storedFiles.delete(imageId));
      return Promise.resolve();
    },
  },
}));

import { CleanupService } from '@services/cleanup.service';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';

const NOW = 1_700_000_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const OLD = NOW - WEEK - 1000;
const RECENT = NOW - 1000;

type LogDoc = { device_id: string; time: number; images?: string[] };
type ImageDoc = { image_id: string; device_id: string; timestamp: number; format: string };

describe('Cleanup of unreachable logs and images', () => {
  let devices: string[];
  let logs: LogDoc[];
  let images: ImageDoc[];

  const matchesTime = (filter: any, value: number) => (filter?.$lt === undefined ? true : value < Number(filter.$lt));

  beforeEach(() => {
    devices = ['known-device'];
    logs = [];
    images = [];
    storedFiles.clear();

    deviceModel.find = jest.fn().mockImplementation((filter: any) => ({
      lean: () => Promise.resolve(devices.filter(id => filter.device_id.$in.includes(id)).map(device_id => ({ device_id }))),
    }));

    deviceLogModel.distinct = jest.fn().mockImplementation((field: string, filter: any) => {
      if (field === 'device_id') {
        return Promise.resolve([...new Set(logs.filter(log => matchesTime(filter.time, log.time)).map(log => log.device_id))]);
      }
      const referenced = logs.flatMap(log => log.images ?? []).filter(imageId => filter.images.$in.includes(imageId));
      return Promise.resolve([...new Set(referenced)]);
    });
    deviceLogModel.deleteMany = jest.fn().mockImplementation((filter: any) => {
      const remaining = logs.filter(log => !(filter.device_id.$in.includes(log.device_id) && matchesTime(filter.time, log.time)));
      const deletedCount = logs.length - remaining.length;
      logs = remaining;
      return Promise.resolve({ deletedCount });
    });

    imageModel.distinct = jest.fn().mockImplementation((field: string, filter: any) => {
      if (field === 'image_id') {
        return Promise.resolve(images.filter(image => filter.image_id.$in.includes(image.image_id)).map(image => image.image_id));
      }
      return Promise.resolve([...new Set(images.filter(image => matchesTime(filter.timestamp, image.timestamp)).map(image => image.device_id))]);
    });
    imageModel.find = jest.fn().mockImplementation((filter: any) => {
      const matched = images.filter(image => image.format === filter.format && matchesTime(filter.timestamp, image.timestamp));
      return {
        select: () => ({
          cursor: () => {
            let index = 0;
            return { next: () => Promise.resolve(index < matched.length ? matched[index++] : null) };
          },
        }),
      };
    });
    imageModel.deleteMany = jest.fn().mockImplementation((filter: any) => {
      const remaining = images.filter(image =>
        filter.image_id
          ? !filter.image_id.$in.includes(image.image_id)
          : !(filter.device_id.$in.includes(image.device_id) && matchesTime(filter.timestamp, image.timestamp)),
      );
      const deletedCount = images.length - remaining.length;
      images = remaining;
      return Promise.resolve({ deletedCount });
    });
  });

  const run = () => new CleanupService().run(NOW);

  it('deletes old logs of devices that no longer exist', async () => {
    logs = [
      { device_id: 'gone-device', time: OLD },
      { device_id: 'gone-device', time: RECENT },
      { device_id: 'known-device', time: OLD },
    ];

    const result = await run();

    expect(result.deletedLogs).toBe(1);
    expect(logs).toEqual([
      { device_id: 'gone-device', time: RECENT },
      { device_id: 'known-device', time: OLD },
    ]);
  });

  it('deletes old images of devices that no longer exist', async () => {
    images = [
      { image_id: 'gone-old', device_id: 'gone-device', timestamp: OLD, format: 'jpeg' },
      { image_id: 'gone-recent', device_id: 'gone-device', timestamp: RECENT, format: 'jpeg' },
      { image_id: 'known-old', device_id: 'known-device', timestamp: OLD, format: 'jpeg' },
    ];

    const result = await run();

    expect(result.deletedImages).toBe(1);
    expect(images.map(image => image.image_id)).toEqual(['gone-recent', 'known-old']);
  });

  it('deletes old user images no log entry references, and keeps referenced ones', async () => {
    logs = [{ device_id: 'known-device', time: OLD, images: ['referenced'] }];
    images = [
      { image_id: 'referenced', device_id: 'known-device', timestamp: OLD, format: 'user/jpeg' },
      { image_id: 'orphaned', device_id: 'known-device', timestamp: OLD, format: 'user/jpeg' },
      { image_id: 'just-uploaded', device_id: 'known-device', timestamp: RECENT, format: 'user/jpeg' },
    ];

    const result = await run();

    expect(result.deletedImages).toBe(1);
    expect(images.map(image => image.image_id)).toEqual(['referenced', 'just-uploaded']);
  });

  it('deletes the pictures of a removed device together with its log entries', async () => {
    logs = [{ device_id: 'gone-device', time: OLD, images: ['picture'] }];
    images = [{ image_id: 'picture', device_id: 'gone-device', timestamp: OLD, format: 'user/jpeg' }];

    const result = await run();

    expect(result).toEqual({ deletedLogs: 1, deletedImages: 1, deletedOrphanedFiles: 0 });
    expect(images).toEqual([]);
  });

  it('deletes stored data no image document points at any more', async () => {
    images = [{ image_id: 'kept', device_id: 'known-device', timestamp: RECENT, format: 'jpeg' }];
    storedFiles.set('kept', OLD);
    storedFiles.set('strays-from-a-crashed-write', OLD);

    const result = await run();

    expect(result.deletedOrphanedFiles).toBe(1);
    expect([...storedFiles.keys()]).toEqual(['kept']);
  });

  it('leaves data alone while its document may still be on its way', async () => {
    storedFiles.set('just-uploaded', RECENT);

    const result = await run();

    expect(result.deletedOrphanedFiles).toBe(0);
    expect([...storedFiles.keys()]).toEqual(['just-uploaded']);
  });
});
