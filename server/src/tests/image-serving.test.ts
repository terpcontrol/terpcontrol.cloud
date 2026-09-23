// uuid ships as an ES module, which this jest setup cannot transform.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const VIDEO = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));

const reads: { imageId: string; range?: { start: number; end: number } }[] = [];

jest.mock('@/databases/imagestore', () => ({
  imageStore: {
    read: (imageId: string, range?: { start: number; end: number }) => {
      reads.push({ imageId, range });
      const { Readable } = require('node:stream');
      return Readable.from(range ? VIDEO.subarray(range.start, range.end + 1) : VIDEO);
    },
    download: (imageId: string) => {
      reads.push({ imageId });
      return Promise.resolve(VIDEO);
    },
  },
}));

import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import shareModel from '@/models/share.model';
import ImageRoute from '@routes/image.route';
import { imageService } from '@services/image.service';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const DEVICE_ID = 'device-1';

const token = sign({ user_id: OWNER_ID, is_admin: false, token_type: 'image' } as DataStoredInToken, SECRET_KEY, { expiresIn: '10m' });

afterAll(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
});

describe('serving a picture out of the image store', () => {
  let app: App;

  beforeEach(() => {
    reads.length = 0;
    (mongoose as any).connect = jest.fn();
    app = new App([new ImageRoute()]);
    (app as any).initializeMiddlewares();
    (app as any).initializeRoutes((app as any).routes);
    (app as any).initializeErrorHandling();

    deviceModel.find = jest.fn().mockImplementation(filter => (filter.owner_id === OWNER_ID ? [{ device_id: DEVICE_ID }] : []));
    shareModel.findOne = jest.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A timelapse as it is written now: metadata only, bytes in the store. */
  const mockTimelapse = (image: Record<string, unknown> = {}) =>
    jest.spyOn(imageService, 'getDeviceImage').mockResolvedValue({
      image_id: 'timelapse-1',
      device_id: DEVICE_ID,
      format: 'mp4',
      duration: '1d',
      timestamp: Date.now(),
      size: VIDEO.length,
      ...image,
    } as any);

  const get = () => request(app.getServer()).get(`/image/${DEVICE_ID}?format=mp4&duration=1d&token=${token}`);

  it('streams the whole video and announces its length', async () => {
    mockTimelapse();

    const response = await get().expect(200);

    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['content-length']).toBe(String(VIDEO.length));
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.body.equals(VIDEO)).toBe(true);
    expect(reads).toEqual([{ imageId: 'timelapse-1', range: undefined }]);
  });

  it('answers a byte range with 206 and reads only that range from the store', async () => {
    mockTimelapse();

    const response = await get().set('Range', 'bytes=100-199').expect(206);

    expect(response.headers['content-range']).toBe(`bytes 100-199/${VIDEO.length}`);
    expect(response.headers['content-length']).toBe('100');
    expect(response.body.equals(VIDEO.subarray(100, 200))).toBe(true);
    expect(reads).toEqual([{ imageId: 'timelapse-1', range: { start: 100, end: 199 } }]);
  });

  it('reads to the end of the file for an open-ended range', async () => {
    mockTimelapse();

    await get().set('Range', 'bytes=4000-').expect(206);

    expect(reads).toEqual([{ imageId: 'timelapse-1', range: { start: 4000, end: VIDEO.length - 1 } }]);
  });

  it('refuses a range past the end of the file', async () => {
    mockTimelapse();

    const response = await get()
      .set('Range', `bytes=${VIDEO.length + 10}-`)
      .expect(416);

    expect(response.headers['content-range']).toBe(`bytes */${VIDEO.length}`);
    expect(reads).toEqual([]);
  });

  it('still serves a picture written before the move, straight from its document', async () => {
    mockTimelapse({ size: undefined, data: VIDEO });

    const response = await get().expect(200);

    expect(response.body.equals(VIDEO)).toBe(true);
    // Nothing to look up: the bytes came with the document.
    expect(reads).toEqual([]);
  });

  it('serves a range out of a picture written before the move as well', async () => {
    mockTimelapse({ size: undefined, data: VIDEO });

    const response = await get().set('Range', 'bytes=10-19').expect(206);

    expect(response.headers['content-range']).toBe(`bytes 10-19/${VIDEO.length}`);
    expect(response.body.equals(VIDEO.subarray(10, 20))).toBe(true);
    expect(reads).toEqual([]);
  });
});
