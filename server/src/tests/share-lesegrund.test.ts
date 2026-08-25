import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import App from '@/app';
import { darfLesen } from '@middlewares/auth.middleware';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import dingModel from '@models/ding.model';
import imageModel from '@models/images.model';
import shareModel from '@models/share.model';
import zeltModel from '@models/zelt.model';
import zielStandModel from '@models/zielstand.model';
import DingRoute from '@routes/ding.route';
import { Ding } from '@fg2/shared-types';
import { sign } from 'jsonwebtoken';
import { SECRET_KEY } from '@config';
import { DataStoredInToken, RequestWithUser } from '@interfaces/auth.interface';

/**
 * A share link is issued for one half of the tent. The numbers and the diary
 * are different disclosures: somebody who posted a chart to a forum did not
 * thereby publish who watered what, the notes about it, or the photographs.
 *
 * Two questions, and both have to be asked: which endpoint a link reaches, and
 * what that endpoint then answers it with. The first alone is not a narrowing -
 * `GET /api/dinge` hands out every art unless it is told otherwise, image_ids
 * of the camera's frames included, and an image_id is the whole of what
 * `GET /image/:device_id?image_id=` asks for.
 */
const ZELT_ID = 'zelt-geteilt';
const BESITZER = '60706478aad6c9ad19a31c84';
const GERAET = 'controller-1';
const SEIT = Date.UTC(2026, 4, 1);
const T = Date.UTC(2026, 4, 10);

let mongo: MongoMemoryServer;
let app: App;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  app = new App([new DingRoute()]);
  (app as any).initializeMiddlewares();
  (app as any).initializeRoutes((app as any).routes);
  (app as any).initializeErrorHandling();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    shareModel.deleteMany({}),
    zeltModel.deleteMany({}),
    dingModel.deleteMany({}),
    imageModel.deleteMany({}),
    deviceModel.deleteMany({}),
    deviceLogModel.deleteMany({}),
    zielStandModel.deleteMany({}),
  ]);
  await zeltModel.create({
    zelt_id: ZELT_ID,
    besitzer_id: BESITZER,
    name: 'Keller',
    geraete: [{ geraet_id: GERAET, seit: SEIT }],
    zeitzone: 'Europe/Berlin',
    tag_null: SEIT,
    erstellt_at: SEIT,
  });
});

// Enough of a request for the guard: a share token and no other credential.
const anfrage = (token: string) =>
  ({ query: { share: token }, params: {}, headers: {}, cookies: {}, header: () => undefined } as unknown as RequestWithUser);

type ShareFelder = { page?: string; charts?: boolean; webcam?: boolean; device_id?: string; owner_id?: string; createdAt?: number };

const teile = async (page: string, charts: boolean, felder: ShareFelder = {}) => {
  const token = `token-${page}-${charts}-${randomUUID()}`;
  await shareModel.create({
    share_id: token,
    owner_id: BESITZER,
    device_id: GERAET,
    page: page,
    token: token,
    charts: charts,
    webcam: false,
    editable: false,
    createdAt: T,
    ...felder,
  });
  return token;
};

/** Everything the tent's two halves are made of, so a page can be asked to hand out the wrong one. */
const fuelleZelt = async () => {
  await dingModel.create({ ding_id: randomUUID(), zelt_id: ZELT_ID, art: 'notiz', name: '', t: T, d: { text: 'Blätter hängen' } });
  await deviceModel.create({
    device_id: GERAET,
    username: GERAET,
    password: 'x',
    owner_id: BESITZER,
    name: 'Controller',
    device_type: 'controller',
    current_firmware: 'fw-9',
  });
  await deviceLogModel.create({ device_id: GERAET, message: 'message-reboot', severity: 1, time: new Date(T) });
  await zielStandModel.create({ zelt_id: ZELT_ID, geraet_id: GERAET, schluessel: 'day.temperature', wert: 27, gilt_ab: T, quelle: 'geraet' });
  await imageModel.create({ image_id: 'frame-1', device_id: GERAET, timestamp: T, format: 'jpeg', data: Buffer.from('jpeg') });
  await imageModel.create({ image_id: 'foto-1', zelt_id: ZELT_ID, timestamp: T, format: 'user/jpeg', data: Buffer.from('jpeg') });
  await imageModel.create({
    image_id: 'film-1',
    device_id: GERAET,
    timestamp: T,
    timestampEnd: T + 3600_000,
    format: 'mp4',
    duration: '1d',
    data: Buffer.from('mp4'),
  });
};

const lies = async (token: string, query = ''): Promise<Ding[]> => {
  const antwort = await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&share=${token}&limit=500${query}`).expect(200);
  return antwort.body.dinge;
};

const arten = (dinge: Ding[]): string[] => [...new Set(dinge.map(ding => ding.art))].sort();

const besitzerToken = () =>
  sign({ user_id: BESITZER, is_admin: false, is_demo: false, token_type: 'user', secret: 'test-secret' } as DataStoredInToken, SECRET_KEY, {
    expiresIn: '10m',
  });

describe('what a share link opens', () => {
  it('does not let a charts link read the diary', async () => {
    // The leak this narrowing exists for: §15.1 lists the read endpoints as
    // `Z | S | A` without narrowing, and taken literally a link shared for the
    // numbers would answer for the tent's entries too.
    const token = await teile('charts', true);

    expect(await darfLesen(anfrage(token), ZELT_ID, 'charts')).toBe(true);
    expect(await darfLesen(anfrage(token), ZELT_ID, 'diary')).toBe(false);
  });

  it('lets a diary link read the diary, and the numbers only when they were ticked', async () => {
    const ohneCharts = await teile('diary', false);
    expect(await darfLesen(anfrage(ohneCharts), ZELT_ID, 'diary')).toBe(true);
    expect(await darfLesen(anfrage(ohneCharts), ZELT_ID, 'charts')).toBe(false);

    const mitCharts = await teile('diary', true);
    expect(await darfLesen(anfrage(mitCharts), ZELT_ID, 'diary')).toBe(true);
    expect(await darfLesen(anfrage(mitCharts), ZELT_ID, 'charts')).toBe(true);
  });

  it('defaults to the diary, so a caller that forgets to say cannot widen a link', async () => {
    const token = await teile('charts', true);
    expect(await darfLesen(anfrage(token), ZELT_ID)).toBe(false);
  });

  it('refuses a token for a tent the share does not reach', async () => {
    const token = await teile('diary', true);
    expect(await darfLesen(anfrage(token), 'zelt-fremd', 'diary')).toBe(false);
  });
});

/**
 * The half of the narrowing the predicate cannot do. `darfLesen` says which
 * endpoint answers; these say what it answers with, and the endpoint is what
 * the reader actually holds in their hands.
 */
describe('what a diary link is answered with', () => {
  it('hands out the diary and not the device half', async () => {
    await fuelleZelt();
    const token = await teile('diary', false);

    const dinge = await lies(token);

    expect(arten(dinge)).toEqual(['bild', 'ereignis', 'notiz', 'zelt']);
    expect(dinge.some(ding => ding.art === 'notiz')).toBe(true);
    for (const verboten of ['geraet', 'ziel', 'film', 'dose', 'kamera']) {
      expect(dinge.filter(ding => ding.art === verboten)).toEqual([]);
    }
  });

  it('hands out the pictures a person took and no camera frame', async () => {
    await fuelleZelt();
    const token = await teile('diary', false);

    const bilder = (await lies(token)).filter(ding => ding.art === 'bild');

    expect(bilder.map(bild => bild.d?.quelle)).toEqual(['hand']);
    // The image_id is the credential `GET /image/:device_id?image_id=` asks for:
    // a link that never learns a frame's id cannot fetch the frame's bytes.
    expect(JSON.stringify(bilder)).not.toContain('frame-1');
    expect(JSON.stringify(bilder)).toContain('foto-1');
  });

  it('cannot ask for the device half by naming it', async () => {
    await fuelleZelt();
    const token = await teile('diary', false);

    expect(await lies(token, '&art=geraet,ziel,film')).toEqual([]);
    expect(arten(await lies(token, '&art=notiz,geraet'))).toEqual(['notiz']);
  });

  it('opens the numbers and the camera when they were ticked', async () => {
    await fuelleZelt();
    const token = await teile('diary', true, { webcam: true });

    const dinge = await lies(token);

    expect(arten(dinge)).toEqual(expect.arrayContaining(['geraet', 'ziel', 'film']));
    expect(
      dinge
        .filter(ding => ding.art === 'bild')
        .map(bild => bild.d?.quelle)
        .sort(),
    ).toEqual(['geraet', 'hand']);
  });

  it('leaves the owner own read untouched', async () => {
    await fuelleZelt();
    const antwort = await request(app.getServer())
      .get(`/api/dinge?zelt_id=${ZELT_ID}&limit=500`)
      .set('Cookie', `Authorization=${besitzerToken()}`)
      .expect(200);

    expect(arten(antwort.body.dinge)).toEqual(expect.arrayContaining(['bild', 'ereignis', 'geraet', 'notiz', 'ziel', 'zelt']));
  });
});

/**
 * §14.3's forward-only law, pointed at the guard rather than at the projections.
 * A device is sold, the next owner binds it, and the seller's link is still out
 * there: it may not follow the hardware into the tent it was never issued for.
 */
describe('a share link and a device that changed hands', () => {
  const FREMDER = '60706478aad6c9ad19a31c99';
  const ZWEITZELT = 'zelt-zweiter-besitzer';

  const verkaufe = async () => {
    await zeltModel.updateOne({ zelt_id: ZELT_ID }, { $set: { 'geraete.0.bis': T + 86_400_000 } });
    await zeltModel.create({
      zelt_id: ZWEITZELT,
      besitzer_id: FREMDER,
      name: 'Neuer Besitzer',
      geraete: [{ geraet_id: GERAET, seit: T + 2 * 86_400_000 }],
      zeitzone: 'Europe/Berlin',
      tag_null: T + 2 * 86_400_000,
      erstellt_at: T + 2 * 86_400_000,
    });
  };

  it('does not read the next owner tent', async () => {
    const token = await teile('diary', false);
    await verkaufe();

    expect(await darfLesen(anfrage(token), ZWEITZELT, 'diary')).toBe(false);
    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZWEITZELT}&share=${token}`).expect(403);
  });

  it('keeps reading the tent it was issued for', async () => {
    const token = await teile('diary', false);
    await verkaufe();

    expect(await darfLesen(anfrage(token), ZELT_ID, 'diary')).toBe(true);
  });

  it('refuses a link minted after the device had left', async () => {
    await verkaufe();
    const spaeter = await teile('diary', false, { createdAt: T + 3 * 86_400_000 });

    expect(await darfLesen(anfrage(spaeter), ZELT_ID, 'diary')).toBe(false);
  });
});
