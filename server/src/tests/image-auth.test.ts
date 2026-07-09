// uuid ships as an ES module, which this jest setup cannot transform.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

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

const makeToken = (token_type: DataStoredInToken['token_type'], user_id = OWNER_ID) =>
  sign({ user_id, is_admin: false, token_type, secret: 'test-secret' } as DataStoredInToken, SECRET_KEY, { expiresIn: '10m' });

afterAll(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
});

describe('GET /image/:device_id authorization', () => {
  let app: App;

  beforeEach(() => {
    (mongoose as any).connect = jest.fn();
    app = new App([new ImageRoute()]);
    // App.run() would connect to the database first; wire up express directly.
    (app as any).initializeMiddlewares();
    (app as any).initializeRoutes((app as any).routes);
    (app as any).initializeErrorHandling();

    jest.spyOn(imageService, 'getDeviceImage').mockResolvedValue({ data: Buffer.from('jpegdata'), format: 'jpeg' } as any);
    deviceModel.find = jest.fn().mockImplementation(filter => (filter.owner_id === OWNER_ID ? [{ device_id: DEVICE_ID }] : []));
    shareModel.findOne = jest.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const get = (query: string) => request(app.getServer()).get(`/image/${DEVICE_ID}?format=jpeg&timestamp=1000${query}`);

  it('accepts the image token from the query parameter', async () => {
    await get(`&token=${makeToken('image')}`).expect(200);
  });

  it('accepts an owner whose Authorization cookie shadows the image query token', async () => {
    // Browsers attach the (user-token) cookie to <img> requests; it must not
    // break authorization for the image token carried in the URL.
    await get(`&token=${makeToken('image')}`)
      .set('Cookie', `Authorization=${makeToken('user')}`)
      .expect(200);
  });

  it('accepts an owner authenticated only by the user-token cookie', async () => {
    await get('').set('Cookie', `Authorization=${makeToken('user')}`).expect(200);
  });

  it('accepts a valid image query token next to an expired cookie', async () => {
    const expired = sign({ user_id: OWNER_ID, is_admin: false, token_type: 'user', secret: 's' }, SECRET_KEY, { expiresIn: '-1s' });
    await get(`&token=${makeToken('image')}`).set('Cookie', `Authorization=${expired}`).expect(200);
  });

  it('rejects a user who does not own the device and has no share link', async () => {
    await get('').set('Cookie', `Authorization=${makeToken('user', '60706478aad6c9ad19a31c99')}`).expect(401);
  });

  it('rejects an image token on non-image-typed access', async () => {
    // The URL-embeddable image token must not unlock user-level endpoints,
    // so the widening only goes from 'user' down to 'image'.
    await request(app.getServer()).post(`/image/${DEVICE_ID}`).set('Authorization', `Bearer ${makeToken('image')}`).expect(401);
  });

  it('serves webcam images through a share link that includes the webcam', async () => {
    shareModel.findOne = jest.fn().mockResolvedValue({ share_id: 'share-1', device_id: DEVICE_ID, webcam: true });
    await get('&share=share-1').expect(200);
  });

  it('rejects webcam images through a share link without webcam access', async () => {
    shareModel.findOne = jest.fn().mockResolvedValue({ share_id: 'share-1', device_id: DEVICE_ID, webcam: false });
    await get('&share=share-1').expect(401);
  });
});
