// uuid ships as an ES module, which this jest setup cannot transform.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { sign } from 'jsonwebtoken';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import deviceModel from '@/models/device.model';
import shareModel from '@/models/share.model';
import ImageRoute from '@routes/image.route';
import { imageService } from '@services/image.service';
import { ONLINE_TIMEOUT } from '@services/device.service';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const DEVICE_ID = 'device-1';

const token = sign({ user_id: OWNER_ID, is_admin: false, token_type: 'image' } as DataStoredInToken, SECRET_KEY, { expiresIn: '10m' });

afterAll(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
});

describe('offline notice drawn into the latest webcam still', () => {
  let app: App;
  let jpeg: Buffer;

  beforeAll(async () => {
    jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#4a5a3a' } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(() => {
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

  const mockImage = (age: number) =>
    jest.spyOn(imageService, 'getDeviceImage').mockResolvedValue({ data: jpeg, format: 'jpeg', timestamp: Date.now() - age } as any);

  const get = (query: string) => request(app.getServer()).get(`/image/${DEVICE_ID}?format=jpeg&token=${token}${query}`);

  it('draws the notice into a stale still requested without a timestamp', async () => {
    mockImage(3 * ONLINE_TIMEOUT);

    const response = await get('').expect(200);
    expect(response.body.equals(jpeg)).toBe(false);
    // Still a usable picture of the original size, just with the caption on top.
    const { width, height } = await sharp(response.body).metadata();
    expect([width, height]).toEqual([640, 480]);
  });

  it('draws the notice for the cache-busting timestamp the webapp sends for the latest still', async () => {
    mockImage(3 * ONLINE_TIMEOUT);

    const response = await get(`&timestamp=${Math.ceil(Date.now() / 5000) * 5000}`).expect(200);
    expect(response.body.equals(jpeg)).toBe(false);
  });

  it('leaves a still requested by timestamp untouched', async () => {
    mockImage(3 * ONLINE_TIMEOUT);

    const response = await get(`&timestamp=${Date.now() - 2 * 60 * 60 * 1000}`).expect(200);
    expect(response.body.equals(jpeg)).toBe(true);
  });

  it('leaves a fresh still untouched', async () => {
    mockImage(ONLINE_TIMEOUT / 2);

    const response = await get('').expect(200);
    expect(response.body.equals(jpeg)).toBe(true);
  });
});
