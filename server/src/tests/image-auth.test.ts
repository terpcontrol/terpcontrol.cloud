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
import zeltModel from '@/models/zelt.model';
import ImageRoute from '@routes/image.route';
import { imageService } from '@services/image.service';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const DEVICE_ID = 'device-1';
const ZELT_ID = 'zelt-1';

const share = (felder: Record<string, unknown>) => ({
  share_id: 'share-1',
  device_id: DEVICE_ID,
  owner_id: OWNER_ID,
  page: 'diary',
  createdAt: 1000,
  ...felder,
});

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

    jest
      .spyOn(imageService, 'getDeviceImage')
      .mockResolvedValue({ data: Buffer.from('jpegdata'), format: 'jpeg', device_id: DEVICE_ID, timestamp: 1000 } as any);
    deviceModel.find = jest.fn().mockImplementation(filter => (filter.owner_id === OWNER_ID ? [{ device_id: DEVICE_ID }] : []));
    shareModel.findOne = jest.fn().mockResolvedValue(null);
    // A share is answered for the tent the row belongs to, so the guard reaches
    // the tent collection for a bound device and its binding window.
    const zelt = { zelt_id: ZELT_ID, besitzer_id: OWNER_ID, geraete: [{ geraet_id: DEVICE_ID, seit: 0 }] };
    zeltModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([zelt]) }) as any;
    zeltModel.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(zelt) }) as any;
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
    await get('')
      .set('Cookie', `Authorization=${makeToken('user')}`)
      .expect(200);
  });

  it('accepts a valid image query token next to an expired cookie', async () => {
    const expired = sign({ user_id: OWNER_ID, is_admin: false, token_type: 'user', secret: 's' }, SECRET_KEY, { expiresIn: '-1s' });
    await get(`&token=${makeToken('image')}`)
      .set('Cookie', `Authorization=${expired}`)
      .expect(200);
  });

  it('rejects a user who does not own the device and has no share link', async () => {
    // The session is fine, the device just is not theirs: 403, not 401. Clients
    // log out on 401, so an access failure must not look like an expired login.
    await get('')
      .set('Cookie', `Authorization=${makeToken('user', '60706478aad6c9ad19a31c99')}`)
      .expect(403);
  });

  it('rejects an image token on non-image-typed access', async () => {
    // The URL-embeddable image token must not unlock user-level endpoints,
    // so the widening only goes from 'user' down to 'image'.
    await request(app.getServer())
      .post(`/image/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${makeToken('image')}`)
      .expect(401);
  });

  it('serves webcam images through a share link that includes the webcam', async () => {
    shareModel.findOne = jest.fn().mockResolvedValue(share({ webcam: true }));
    await get('&share=share-1').expect(200);
  });

  it('rejects webcam images through a share link without webcam access', async () => {
    shareModel.findOne = jest.fn().mockResolvedValue(share({ webcam: false }));
    await get('&share=share-1').expect(403);
  });

  it('rejects a camera frame named by image_id through the same link', async () => {
    // The allowance this closes: a link without the camera was handed any row
    // it could name, because it was assumed to only ever learn the ids of diary
    // photographs. It learns every frame's id from `GET /api/dinge`.
    shareModel.findOne = jest.fn().mockResolvedValue(share({ webcam: false }));
    await request(app.getServer()).get(`/image/${DEVICE_ID}?format=jpeg&image_id=frame-1&share=share-1`).expect(403);
  });

  it('refuses a row it cannot place in any tent rather than serving it', async () => {
    // Every credential below ownership is issued for one tent; a row that
    // belongs to none of them is not this reader's to see.
    shareModel.findOne = jest.fn().mockResolvedValue(share({ webcam: true }));
    zeltModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) }) as any;
    await request(app.getServer()).get(`/image/${DEVICE_ID}?format=jpeg&image_id=frame-1&share=share-1`).expect(403);
  });
});
