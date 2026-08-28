import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import App, { redigiereUrl } from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import dingModel from '@models/ding.model';
import schluesselModel from '@models/schluessel.model';
import zeltModel from '@models/zelt.model';
import zugangsschluesselModel from '@models/zugangsschluessel.model';
import DingRoute from '@routes/ding.route';
import { SCHLUESSEL_MAX } from '@services/schluessel.service';
import SchluesselRoute from '@routes/schluessel.route';

// Neither key belongs to an account, and neither tent here owns a device: the
// club that shares six phones and no controller is the case these keys exist for.
const BESITZER = '60706478aad6c9ad19a31c84';
const FREMDER = '60706478aad6c9ad19a31c99';
const ZELT_ID = 'zelt-club';
const NACHBARZELT = 'zelt-nebenan';
const TAG_NULL = Date.UTC(2026, 4, 1);

let mongo: MongoMemoryServer;
let app: App;
let anna: Record<string, unknown>;

const token = (user_id: string) =>
  sign({ user_id: user_id, is_admin: false, is_demo: false, token_type: 'user', secret: 'test-secret' } as DataStoredInToken, SECRET_KEY, {
    expiresIn: '10m',
  });

const alsBesitzer = (aufruf: request.Test) => aufruf.set('Cookie', `Authorization=${token(BESITZER)}`);

const ding = (felder: Record<string, unknown> = {}) => ({
  ding_id: randomUUID(),
  zelt_id: ZELT_ID,
  art: 'notiz',
  name: '',
  t: TAG_NULL + 60_000,
  d: { text: 'Blätter hängen' },
  ...felder,
});

const zelt = (zelt_id: string) => ({
  zelt_id: zelt_id,
  besitzer_id: BESITZER,
  name: 'Club',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: TAG_NULL,
  erstellt_at: TAG_NULL,
});

/** The owner mints a key exactly the way the webapp does, and reads the token exactly once. */
const minteZugang = async (zelt_id = ZELT_ID): Promise<string> => {
  const antwort = await alsBesitzer(request(app.getServer()).post(`/api/zelte/${zelt_id}/zugangsschluessel`)).expect(200);
  return antwort.body.token;
};

const minteSchluessel = async (mensch_ding_id: string, zelt_id = ZELT_ID): Promise<string> => {
  const antwort = await alsBesitzer(
    request(app.getServer()).post(`/api/zelte/${zelt_id}/schluessel`).send({ mensch_ding_id: mensch_ding_id }),
  ).expect(200);
  return antwort.body.token;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await dingModel.syncIndexes();

  app = new App([new DingRoute(), new SchluesselRoute()]);
  (app as any).initializeMiddlewares();
  (app as any).initializeRoutes((app as any).routes);
  (app as any).initializeErrorHandling();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([dingModel.deleteMany({}), zeltModel.deleteMany({}), schluesselModel.deleteMany({}), zugangsschluesselModel.deleteMany({})]);
  await zeltModel.create(zelt(ZELT_ID));
  await zeltModel.create({ ...zelt(NACHBARZELT), zelt_id: NACHBARZELT });

  anna = ding({ art: 'mensch', name: 'Anna', d: { farbe: '#7c3aed' } });
  await dingModel.create(anna);
});

describe('the per-Zelt read key', () => {
  it('is minted by the owner, and by nobody else', async () => {
    const antwort = await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/zugangsschluessel`)).expect(200);
    expect(antwort.body.token).toEqual(expect.any(String));

    await request(app.getServer())
      .post(`/api/zelte/${ZELT_ID}/zugangsschluessel`)
      .set('Cookie', `Authorization=${token(FREMDER)}`)
      .expect(403);
    await request(app.getServer()).post(`/api/zelte/${ZELT_ID}/zugangsschluessel`).expect(401);
  });

  // The token exists in the minting response and nowhere else. A database dump
  // must not hand out working keys.
  it('is stored hashed, never in the clear', async () => {
    const schluessel = await minteZugang();
    const gespeichert = await zugangsschluesselModel.findOne({ zelt_id: ZELT_ID }).lean();

    expect(gespeichert.hash).not.toBe(schluessel);
    expect(JSON.stringify(gespeichert)).not.toContain(schluessel);
  });

  it('reads the tent it belongs to, with no session at all', async () => {
    await dingModel.create(ding());
    const schluessel = await minteZugang();

    const antwort = await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`).set('x-api-key', schluessel).expect(200);
    expect(antwort.body.dinge.length).toBeGreaterThan(0);
  });

  // It is offered next to the export, for a spreadsheet and a script. Writing is
  // not what it is for, and there is no path by which it becomes what it is for.
  it('cannot write anything at all', async () => {
    const schluessel = await minteZugang();

    await request(app.getServer()).post('/api/dinge').set('x-api-key', schluessel).send(ding()).expect(403);
    await request(app.getServer())
      .post('/api/dinge/stapel')
      .set('x-api-key', schluessel)
      .send({ dinge: [ding()] })
      .expect(403);

    const offen = await dingModel.create(ding({ art: 'zustand', t_ende: null, d: { text: 'Lüfter laut' } }));
    await request(app.getServer()).patch(`/api/dinge/${offen.ding_id}`).set('x-api-key', schluessel).send({ t_ende: Date.now() }).expect(403);

    expect(await dingModel.countDocuments({ art: 'notiz' })).toBe(0);
  });

  it('reaches only its own tent', async () => {
    const schluessel = await minteZugang();

    await request(app.getServer()).get(`/api/dinge?zelt_id=${NACHBARZELT}`).set('x-api-key', schluessel).expect(403);
  });

  /** Rotation always leaves a working key behind. An owner who pasted theirs into the wrong window wants none. */
  it('can be switched off and not only rotated', async () => {
    const schluessel = await minteZugang();
    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`).set('x-api-key', schluessel).expect(200);

    const antwort = await alsBesitzer(request(app.getServer()).delete(`/api/zelte/${ZELT_ID}/zugangsschluessel`)).expect(200);
    expect(antwort.body.geloescht).toBe(true);

    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`).set('x-api-key', schluessel).expect(403);
    expect(await zugangsschluesselModel.countDocuments({ zelt_id: ZELT_ID })).toBe(0);

    await request(app.getServer())
      .delete(`/api/zelte/${ZELT_ID}/zugangsschluessel`)
      .set('Cookie', `Authorization=${token(FREMDER)}`)
      .expect(403);
  });

  it('stops working the moment it is rotated', async () => {
    const alt = await minteZugang();
    const neu = await minteZugang();

    expect(neu).not.toBe(alt);
    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`).set('x-api-key', alt).expect(403);
    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}`).set('x-api-key', neu).expect(200);
  });
});

describe('the club write key', () => {
  it('is minted for a mensch of this tent, and only for one', async () => {
    const antwort = await alsBesitzer(
      request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: anna.ding_id }),
    ).expect(200);
    expect(antwort.body.url).toBe(`/z/${ZELT_ID}?k=${antwort.body.token}`);

    const keinMensch = await dingModel.create(ding({ art: 'gabe', d: { wasser_l: 5 } }));
    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: keinMensch.ding_id })).expect(400);
    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: randomUUID() })).expect(400);
    // Anna is not in the neighbouring tent, so she cannot be given a key to it.
    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${NACHBARZELT}/schluessel`).send({ mensch_ding_id: anna.ding_id })).expect(400);
  });

  it('writes the three arts it may write, signed as the person it was handed to', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);

    const antwort = await request(app.getServer())
      .post(`/api/dinge?k=${schluessel}`)
      .send(ding({ art: 'gabe', d: { wasser_l: 5 } }))
      .expect(200);

    expect(antwort.body.ding.akteur).toBe(anna.ding_id);
  });

  /**
   * The line §13.5 draws. A key logs what happened in the tent; it does not
   * restructure it - no plants, no phases, no people, no runs.
   */
  it('cannot write a pflanze, a phase, a mensch or a lauf', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);

    for (const verboten of [
      ding({ art: 'pflanze', name: 'A3 · Wedding Cake', d: { sorte: 'Wedding Cake' } }),
      ding({ art: 'phase', d: { stufe: 'flowering' } }),
      ding({ art: 'mensch', name: 'Ben', d: { farbe: '#059669' } }),
      ding({ art: 'lauf', d: { nummer: 2 } }),
    ]) {
      const antwort = await request(app.getServer()).post('/api/dinge').set('X-Schluessel', schluessel).send(verboten).expect(400);
      expect(antwort.body.problems.map((problem: any) => problem.path)).toContain('art');
    }

    expect(await dingModel.countDocuments({ art: { $in: ['pflanze', 'phase', 'lauf'] } })).toBe(0);
  });

  /**
   * The key *is* the person. A body that names an akteur is refused rather than
   * quietly corrected: a phone that believes it signed an entry as somebody else
   * has to be told that it did not.
   */
  it('cannot sign an entry as somebody else', async () => {
    const ben = await dingModel.create(ding({ art: 'mensch', name: 'Ben', d: { farbe: '#059669' } }));
    const schluessel = await minteSchluessel(anna.ding_id as string);

    const antwort = await request(app.getServer())
      .post('/api/dinge')
      .set('X-Schluessel', schluessel)
      .send(ding({ art: 'gabe', akteur: ben.ding_id, d: { wasser_l: 5 } }))
      .expect(400);

    expect(antwort.body.problems.map((problem: any) => problem.path)).toEqual(['akteur']);
    expect(await dingModel.countDocuments({ art: 'gabe' })).toBe(0);
  });

  it('signs every item of an offline batch as its person too', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);

    const antwort = await request(app.getServer())
      .post('/api/dinge/stapel')
      .set('X-Schluessel', schluessel)
      .send({ dinge: [ding(), ding({ art: 'gabe', d: { wasser_l: 3 } })] })
      .expect(200);

    expect(antwort.body.ergebnisse.map((ergebnis: any) => ergebnis.ding.akteur)).toEqual([anna.ding_id, anna.ding_id]);
  });

  it('reads the diary of its tent and nothing next door', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);

    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&k=${schluessel}`).expect(200);
    await request(app.getServer()).get(`/api/dinge?zelt_id=${NACHBARZELT}&k=${schluessel}`).expect(403);
    await request(app.getServer())
      .post('/api/dinge')
      .set('X-Schluessel', schluessel)
      .send(ding({ zelt_id: NACHBARZELT }))
      .expect(403);
  });

  it('closes a Zustand but may not touch a Pflanze', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);
    const offen = await dingModel.create(ding({ art: 'zustand', t_ende: null, d: { text: 'Trauermücken' } }));
    const pflanze = await dingModel.create(ding({ art: 'pflanze', name: 'A3', d: {} }));

    await request(app.getServer())
      .patch(`/api/dinge/${offen.ding_id}`)
      .set('X-Schluessel', schluessel)
      .send({ d: { geschlossen_von: anna.ding_id } })
      .expect(200);
    await request(app.getServer()).patch(`/api/dinge/${pflanze.ding_id}`).set('X-Schluessel', schluessel).send({ t_ende: Date.now() }).expect(403);
  });

  it('is stored hashed, never in the clear', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);
    const gespeichert = await schluesselModel.findOne({ zelt_id: ZELT_ID }).lean();

    expect(JSON.stringify(gespeichert)).not.toContain(schluessel);
  });

  /**
   * §13.5 says „shown once, revocable" and §15.3 names the endpoint. A key that
   * can only be stopped by writing to the database by hand is not revocable;
   * the club whose phone was lost is the whole reason the word is in the spec.
   */
  it('is revoked through the API, and stops answering at once', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);
    const { schluessel_id } = (await schluesselModel.findOne({ zelt_id: ZELT_ID }).lean()) as any;

    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&k=${schluessel}`).expect(200);

    const antwort = await alsBesitzer(request(app.getServer()).delete(`/api/schluessel/${schluessel_id}`)).expect(200);
    expect(antwort.body.widerrufen_at).toEqual(expect.any(Number));

    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&k=${schluessel}`).expect(403);
    await request(app.getServer())
      .post('/api/dinge')
      .set('X-Schluessel', schluessel)
      .send(ding({ art: 'gabe', d: { wasser_l: 5 } }))
      .expect(403);
  });

  // The refusal says no and says nothing else: an id that exists in somebody
  // else's tent and an id that exists nowhere have to be indistinguishable, or
  // the endpoint answers „does this key exist?" for anyone who asks.
  it('is revoked by the owner of its Zelt and by nobody else', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);
    const { schluessel_id } = (await schluesselModel.findOne({ zelt_id: ZELT_ID }).lean()) as any;

    const fremd = await request(app.getServer())
      .delete(`/api/schluessel/${schluessel_id}`)
      .set('Cookie', `Authorization=${token(FREMDER)}`)
      .expect(403);
    const erfunden = await request(app.getServer())
      .delete(`/api/schluessel/${randomUUID()}`)
      .set('Cookie', `Authorization=${token(FREMDER)}`)
      .expect(403);

    expect(fremd.text).toEqual(erfunden.text);
    expect(fremd.text).not.toContain(ZELT_ID);
    await request(app.getServer()).delete(`/api/schluessel/${schluessel_id}`).expect(401);
    // Still working: the refusals changed nothing.
    await request(app.getServer()).get(`/api/dinge?zelt_id=${ZELT_ID}&k=${schluessel}`).expect(200);
  });

  it('is listed for its owner, with the token nowhere in the answer', async () => {
    const schluessel = await minteSchluessel(anna.ding_id as string);
    const { schluessel_id } = (await schluesselModel.findOne({ zelt_id: ZELT_ID }).lean()) as any;

    const antwort = await alsBesitzer(request(app.getServer()).get(`/api/zelte/${ZELT_ID}/schluessel`)).expect(200);

    expect(antwort.body.schluessel).toEqual([
      {
        schluessel_id: schluessel_id,
        mensch_ding_id: anna.ding_id,
        erstellt_at: expect.any(Number),
        widerrufen_at: null,
      },
    ]);
    expect(JSON.stringify(antwort.body)).not.toContain(schluessel);

    // A revoked key stays in the list: „who could write in my tent" is a
    // question an owner asks after the fact, and a deleted row cannot answer it.
    await alsBesitzer(request(app.getServer()).delete(`/api/schluessel/${schluessel_id}`)).expect(200);
    const danach = await alsBesitzer(request(app.getServer()).get(`/api/zelte/${ZELT_ID}/schluessel`)).expect(200);
    expect(danach.body.schluessel[0].widerrufen_at).toEqual(expect.any(Number));

    await request(app.getServer())
      .get(`/api/zelte/${ZELT_ID}/schluessel`)
      .set('Cookie', `Authorization=${token(FREMDER)}`)
      .expect(403);
  });

  /** A number of live write credentials that nobody can name is a number nobody revokes. */
  it('stops being minted once the Zelt is full', async () => {
    await schluesselModel.insertMany(
      Array.from({ length: SCHLUESSEL_MAX }, (_unused, i) => ({
        schluessel_id: randomUUID(),
        zelt_id: ZELT_ID,
        mensch_ding_id: anna.ding_id,
        hash: `hash-${i}`,
        erstellt_at: TAG_NULL,
        widerrufen_at: null,
      })),
    );

    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: anna.ding_id })).expect(409);

    const eines = await schluesselModel.findOne({ zelt_id: ZELT_ID }).lean();
    await alsBesitzer(request(app.getServer()).delete(`/api/schluessel/${eines.schluessel_id}`)).expect(200);
    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: anna.ding_id })).expect(200);
  });

  /**
   * §13.5 mandates the `?k=` URL form, so the token is in every request line
   * morgan writes into logs/debug/*.log for 30 days - and into the proxy's
   * access log, the browser history and any Referer the page hands on.
   */
  it('is not written into the request log', () => {
    expect(redigiereUrl('/api/dinge?zelt_id=zelt-club&k=deadbeef')).toBe('/api/dinge?zelt_id=zelt-club&k=redacted');
    expect(redigiereUrl('/api/dinge?share=abc123&art=notiz')).toBe('/api/dinge?share=redacted&art=notiz');
    expect(redigiereUrl('/image/controller-1?format=jpeg&token=abc')).toBe('/image/controller-1?format=jpeg&token=redacted');
    // Nothing to hide, nothing rewritten: an untouched line stays byte for byte
    // what it was, so a log is still the request that was made.
    expect(redigiereUrl('/api/dinge?zelt_id=zelt-club&art=notiz,gabe')).toBe('/api/dinge?zelt_id=zelt-club&art=notiz,gabe');
    expect(redigiereUrl('/api/zelte')).toBe('/api/zelte');
  });
});
