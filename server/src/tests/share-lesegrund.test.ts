import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { darfLesen } from '@middlewares/auth.middleware';
import shareModel from '@models/share.model';
import zeltModel from '@models/zelt.model';
import { RequestWithUser } from '@interfaces/auth.interface';

/**
 * A share link is issued for one half of the tent. The numbers and the diary
 * are different disclosures: somebody who posted a chart to a forum did not
 * thereby publish who watered what, the notes about it, or the photographs.
 */
const ZELT_ID = 'zelt-geteilt';
const GERAET = 'controller-1';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([shareModel.deleteMany({}), zeltModel.deleteMany({})]);
  await zeltModel.create({
    zelt_id: ZELT_ID,
    besitzer_id: '60706478aad6c9ad19a31c84',
    name: 'Keller',
    geraete: [{ geraet_id: GERAET, seit: Date.UTC(2026, 4, 1) }],
    zeitzone: 'Europe/Berlin',
    tag_null: Date.UTC(2026, 4, 1),
    erstellt_at: Date.UTC(2026, 4, 1),
  });
});

// Enough of a request for the guard: a share token and no other credential.
const anfrage = (token: string) =>
  ({ query: { share: token }, params: {}, headers: {}, cookies: {}, header: () => undefined } as unknown as RequestWithUser);

const teile = async (page: string, charts: boolean) => {
  const token = `token-${page}-${charts}`;
  await shareModel.create({
    share_id: token,
    owner_id: '60706478aad6c9ad19a31c84',
    device_id: GERAET,
    page: page,
    token: token,
    charts: charts,
    webcam: false,
    editable: false,
    createdAt: Date.now(),
  });
  return token;
};

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
