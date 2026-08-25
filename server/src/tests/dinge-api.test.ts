import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import zeltModel from '@models/zelt.model';
import DingRoute from '@routes/ding.route';

// The tent under test owns no device. That is not a variant of this suite, it is
// the reference case: every art written here is human-entered, no handler is
// given a geraet_id, and `geraete: []` must never be an empty state or a lesser
// tier. Nothing below creates a Device, and the last test proves none was.
const BESITZER = '60706478aad6c9ad19a31c84';
const ZELT_ID = 'zelt-ohne-geraet';
const TAG = 24 * 60 * 60 * 1000;
const TAG_NULL = Date.UTC(2026, 4, 1);
const JETZT = TAG_NULL + 30 * TAG;

let mongo: MongoMemoryServer;
let app: App;

const token = sign(
  { user_id: BESITZER, is_admin: false, is_demo: false, token_type: 'user', secret: 'test-secret' } as DataStoredInToken,
  SECRET_KEY,
  {
    expiresIn: '10m',
  },
);

const alsBesitzer = (aufruf: request.Test) => aufruf.set('Cookie', `Authorization=${token}`);

const notiz = (felder: Record<string, unknown> = {}) => ({
  ding_id: randomUUID(),
  zelt_id: ZELT_ID,
  art: 'notiz',
  name: '',
  t: TAG_NULL + TAG,
  d: { text: 'Blätter hängen' },
  ...felder,
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await dingModel.syncIndexes();

  // The route under test and nothing else. Reaching for the whole registry here
  // would import the device half of the server, which starts an MQTT client and
  // an RTSP poller in the middle of a suite that has no use for either - the
  // registry is exercised by the route table test instead.
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
  await Promise.all([dingModel.deleteMany({}), zeltModel.deleteMany({}), deviceModel.deleteMany({})]);
  await zeltModel.create({
    zelt_id: ZELT_ID,
    besitzer_id: BESITZER,
    name: 'Keller',
    geraete: [],
    zeitzone: 'Europe/Berlin',
    tag_null: TAG_NULL,
    erstellt_at: TAG_NULL,
  });
});

describe('GET /api/dinge', () => {
  /**
   * The case a cursor on `t` alone gets wrong. Sixteen entries typed in one
   * sitting share a millisecond, and a page boundary that falls inside that
   * millisecond either repeats the rows on both sides of it or loses them for good.
   */
  it('pages exactly through Dinge that all share one timestamp', async () => {
    const erwartet = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const eintrag = notiz({ t: TAG_NULL + TAG });
      erwartet.add(eintrag.ding_id);
      await dingModel.create(eintrag);
    }

    const gesehen: string[] = [];
    let cursor = '';
    for (let seite = 0; seite < 10; seite++) {
      const antwort = await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&art=notiz&limit=5&cursor=${cursor}`)).expect(200);
      gesehen.push(...antwort.body.dinge.map((ding: any) => ding.ding_id));
      cursor = antwort.body.cursor ?? '';
      if (!cursor) break;
    }

    expect(gesehen).toHaveLength(16);
    expect(new Set(gesehen)).toEqual(erwartet);
    // Repeats and skips are two halves of the same bug, so both are asserted.
    expect(new Set(gesehen).size).toBe(gesehen.length);
    expect(cursor).toBe('');
  });

  /**
   * The merge is where a cursor is easiest to lose: one half of the page comes
   * out of mongo and the other out of a projection, and the tent's own Ding sits
   * at `tag_null` - the same moment a back-dated entry lands on. If the two
   * halves are not paged under one order, the row on the boundary is served
   * twice or never.
   */
  it('pages stored and projected Dinge under one order', async () => {
    const erwartet = new Set<string>([`zelt:${ZELT_ID}`]);
    for (let i = 0; i < 9; i++) {
      const eintrag = notiz({ t: TAG_NULL });
      erwartet.add(eintrag.ding_id);
      await dingModel.create(eintrag);
    }

    const gesehen: string[] = [];
    let cursor = '';
    for (let seite = 0; seite < 10; seite++) {
      const antwort = await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&limit=4&cursor=${cursor}`)).expect(200);
      gesehen.push(...antwort.body.dinge.map((ding: any) => ding.ding_id));
      cursor = antwort.body.cursor ?? '';
      if (!cursor) break;
    }

    expect(new Set(gesehen)).toEqual(erwartet);
    expect(gesehen).toHaveLength(erwartet.size);
  });

  it('hands out a cursor only while there is another page', async () => {
    await dingModel.create(notiz());
    await dingModel.create(notiz());

    const voll = await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&art=notiz&limit=2`)).expect(200);
    expect(voll.body.dinge).toHaveLength(2);
    expect(voll.body.cursor).toBeUndefined();
  });

  it('merges the projected Ding of the tent itself into the same list', async () => {
    await dingModel.create(notiz());

    const antwort = await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`)).expect(200);
    const arten = antwort.body.dinge.map((ding: any) => ding.art);

    expect(arten).toContain('notiz');
    expect(arten).toContain('zelt');
    expect(antwort.body.dinge.find((ding: any) => ding.art === 'zelt').ding_id).toBe(`zelt:${ZELT_ID}`);
    // Six of the nine projections need a device and answer with nothing here,
    // and an art with no rows is simply not in the list.
    expect(arten).not.toContain('geraet');
    expect(arten).not.toContain('ereignis');
  });

  // A point happened at `t`; an interval is in the window as soon as it overlaps
  // it, or a Zustand opened in March disappears from every window after it.
  it('filters points on t and intervals on overlap', async () => {
    const alterZustand = await dingModel.create(notiz({ art: 'zustand', name: '', t: TAG_NULL, t_ende: null, d: { text: 'Lüfter laut' } }));
    const alteNotiz = await dingModel.create(notiz({ t: TAG_NULL }));

    const antwort = await alsBesitzer(
      request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&art=notiz,zustand&von=${TAG_NULL + 10 * TAG}&bis=${JETZT}`),
    ).expect(200);
    const ids = antwort.body.dinge.map((ding: any) => ding.ding_id);

    expect(ids).toContain(alterZustand.ding_id);
    expect(ids).not.toContain(alteNotiz.ding_id);
  });

  it('refuses an art nobody has, a broken window and a cursor it did not hand out', async () => {
    await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&art=giesskanne`)).expect(400);
    await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&von=gestern`)).expect(400);
    await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&limit=0`)).expect(400);
    await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&limit=9000`)).expect(400);
    await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&cursor=selbst-erfunden`)).expect(400);
  });
});

describe('POST /api/dinge', () => {
  it('logs one watering however often a bad connection resends it', async () => {
    const gabe = notiz({ art: 'gabe', d: { wasser_l: 5 } });

    for (let versuch = 0; versuch < 3; versuch++) {
      await alsBesitzer(request(app.getServer()).post('/api/dinge').send(gabe)).expect(200);
    }

    expect(await dingModel.countDocuments({ ding_id: gabe.ding_id })).toBe(1);
  });

  it('leaves the stored Ding byte-identical across a retry, erfasst_at included', async () => {
    const gabe = notiz({ art: 'gabe', d: { wasser_l: 5 } });

    const erst = await alsBesitzer(request(app.getServer()).post('/api/dinge').send(gabe)).expect(200);
    await new Promise(weiter => setTimeout(weiter, 5));
    const nochmal = await alsBesitzer(request(app.getServer()).post('/api/dinge').send(gabe)).expect(200);

    expect(nochmal.body.ding).toEqual(erst.body.ding);
    expect(erst.body.ding.erfasst_at).toEqual(expect.any(Number));
  });

  /**
   * The other half of the upsert: an id that is taken must not be a way to
   * rewrite what is already there. A watering silently becoming a note is
   * exactly what an append-only diary promises cannot happen.
   */
  it('refuses a different Ding under a ding_id that is taken', async () => {
    const gabe = notiz({ art: 'gabe', d: { wasser_l: 5 } });
    await alsBesitzer(request(app.getServer()).post('/api/dinge').send(gabe)).expect(200);

    await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send({ ...gabe, art: 'notiz', d: { text: 'doch nur eine Notiz' } }),
    ).expect(409);

    const gespeichert = await dingModel.findOne({ ding_id: gabe.ding_id }).lean();
    expect(gespeichert.art).toBe('gabe');
    expect(gespeichert.d).toEqual({ wasser_l: 5 });
  });

  it('refuses an art that is projected rather than stored', async () => {
    const antwort = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ art: 'bild', d: undefined })),
    ).expect(400);

    expect(antwort.body.problems.map((problem: any) => problem.path)).toContain('art');
  });

  it('refuses erfasst_at and geraet_id from a client', async () => {
    const mitStempel = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ erfasst_at: 1 })),
    ).expect(400);
    expect(mitStempel.body.problems.map((problem: any) => problem.path)).toContain('erfasst_at');

    const mitGeraet = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ geraet_id: 'controller-1' })),
    ).expect(400);
    expect(mitGeraet.body.problems.map((problem: any) => problem.path)).toContain('geraet_id');
  });

  // `validateDing` is pure and cannot ask a database, so a pour attributed to
  // somebody who does not exist gets through it. It must not get past the service.
  it('refuses an akteur that is nobody in this Zelt, and accepts one who is', async () => {
    const fremder = randomUUID();
    const abgelehnt = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ akteur: fremder })),
    ).expect(400);
    expect(abgelehnt.body.problems.map((problem: any) => problem.path)).toEqual(['akteur']);

    const anna = notiz({ art: 'mensch', name: 'Anna', d: { farbe: '#7c3aed' } });
    await alsBesitzer(request(app.getServer()).post('/api/dinge').send(anna)).expect(200);
    await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ akteur: anna.ding_id })),
    ).expect(200);
  });

  it('refuses a rel edge pointing into another tent', async () => {
    const woanders = await dingModel.create(notiz({ zelt_id: 'zelt-2', art: 'pflanze', name: 'A3', d: {} }));

    const antwort = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge')
        .send(notiz({ art: 'gabe', d: { wasser_l: 5 }, rel: { an: [woanders.ding_id] } })),
    ).expect(400);

    expect(antwort.body.problems.map((problem: any) => problem.path)).toEqual(['rel.an[0]']);
  });
});

describe('PATCH /api/dinge/:ding_id', () => {
  it('closes an open Zustand', async () => {
    const offen = await dingModel.create(notiz({ art: 'zustand', t_ende: null, d: { text: 'Lüfter laut' } }));
    const ende = TAG_NULL + 5 * TAG;

    const antwort = await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${offen.ding_id}`).send({ t_ende: ende })).expect(200);

    expect(antwort.body.ding.t_ende).toBe(ende);
    expect(antwort.body.ding.d).toEqual({ text: 'Lüfter laut' });
  });

  it('refuses to change what a Ding says happened', async () => {
    const gabe = await dingModel.create(notiz({ art: 'gabe', d: { wasser_l: 5 } }));

    await alsBesitzer(
      request(app.getServer())
        .patch(`/api/dinge/${gabe.ding_id}`)
        .send({ d: { wasser_l: 9 } }),
    ).expect(400);
    await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${gabe.ding_id}`).send({ name: 'anders' })).expect(400);
    await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${gabe.ding_id}`).send({ t: TAG_NULL })).expect(400);

    expect((await dingModel.findOne({ ding_id: gabe.ding_id }).lean()).d).toEqual({ wasser_l: 5 });
  });

  it('supersedes a Gabe with the correction that replaces it', async () => {
    const falsch = await dingModel.create(notiz({ art: 'gabe', d: { wasser_l: 6 } }));
    const richtig = await dingModel.create(notiz({ art: 'gabe', d: { wasser_l: 4 } }));

    await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${falsch.ding_id}`).send({ storniert_von: richtig.ding_id })).expect(200);
    // A correction nobody wrote is not a correction.
    await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${falsch.ding_id}`).send({ storniert_von: randomUUID() })).expect(400);

    expect((await dingModel.findOne({ ding_id: falsch.ding_id }).lean()).storniert_von).toBe(richtig.ding_id);
  });

  it('refuses a ding_id nobody has', async () => {
    await alsBesitzer(request(app.getServer()).patch(`/api/dinge/${randomUUID()}`).send({ t_ende: JETZT })).expect(403);
  });
});

describe('POST /api/dinge/stapel', () => {
  it('reports every item on its own and writes the ones that hold', async () => {
    const gut = notiz({ art: 'gabe', d: { wasser_l: 5 } });
    const auchGut = notiz();
    const schlecht = notiz({ art: 'gabe', d: {} });

    const antwort = await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge/stapel')
        .send({ dinge: [gut, schlecht, auchGut] }),
    ).expect(200);

    expect(antwort.body.ergebnisse.map((ergebnis: any) => ergebnis.ok)).toEqual([true, false, true]);
    expect(antwort.body.ergebnisse[1].problems.map((problem: any) => problem.path)).toEqual(['d.wasser_l']);
    expect(await dingModel.countDocuments({})).toBe(2);
  });

  it('drains the same queue twice without doubling it', async () => {
    const dinge = [notiz(), notiz({ art: 'gabe', d: { wasser_l: 3 } })];

    await alsBesitzer(request(app.getServer()).post('/api/dinge/stapel').send({ dinge: dinge })).expect(200);
    const nochmal = await alsBesitzer(request(app.getServer()).post('/api/dinge/stapel').send({ dinge: dinge })).expect(200);

    expect(nochmal.body.ergebnisse.every((ergebnis: any) => ergebnis.ok)).toBe(true);
    expect(await dingModel.countDocuments({})).toBe(2);
  });

  it('refuses a batch that reaches a tent the caller may not write', async () => {
    await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge/stapel')
        .send({ dinge: [notiz(), notiz({ zelt_id: 'zelt-von-jemand-anderem' })] }),
    ).expect(403);

    expect(await dingModel.countDocuments({})).toBe(0);
  });

  it('refuses a batch that names no tent at all', async () => {
    await alsBesitzer(request(app.getServer()).post('/api/dinge/stapel').send({ dinge: [] })).expect(403);
    await alsBesitzer(request(app.getServer()).post('/api/dinge/stapel').send({})).expect(403);
  });
});

describe('a tent with no device', () => {
  it('carries the whole surface without one ever being asked for', async () => {
    const anna = notiz({ art: 'mensch', name: 'Anna', d: { farbe: '#7c3aed' } });
    const pflanze = notiz({ art: 'pflanze', name: 'A3 · Wedding Cake', d: { sorte: 'Wedding Cake' } });
    await alsBesitzer(request(app.getServer()).post('/api/dinge').send(anna)).expect(200);
    await alsBesitzer(request(app.getServer()).post('/api/dinge').send(pflanze)).expect(200);

    await alsBesitzer(
      request(app.getServer())
        .post('/api/dinge/stapel')
        .send({ dinge: [notiz({ art: 'gabe', akteur: anna.ding_id, rel: { an: [pflanze.ding_id] }, d: { wasser_l: 4 } })] }),
    ).expect(200);

    const offen = notiz({ art: 'zustand', t_ende: null, akteur: anna.ding_id, d: { text: 'Trauermücken' } });
    await alsBesitzer(request(app.getServer()).post('/api/dinge').send(offen)).expect(200);
    await alsBesitzer(
      request(app.getServer())
        .patch(`/api/dinge/${offen.ding_id}`)
        .send({ d: { geschlossen_von: anna.ding_id } }),
    ).expect(200);

    const seite = await alsBesitzer(request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`)).expect(200);

    expect(seite.body.dinge.map((ding: any) => ding.art).sort()).toEqual(['gabe', 'mensch', 'pflanze', 'zelt', 'zustand']);
    expect(seite.body.dinge.every((ding: any) => ding.geraet_id === undefined)).toBe(true);
    expect(await deviceModel.countDocuments({})).toBe(0);
  });
});
