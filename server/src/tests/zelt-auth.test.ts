import { randomUUID } from 'crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import { Routes } from '@interfaces/routes.interface';
import dingModel from '@models/ding.model';
import schluesselModel from '@models/schluessel.model';
import shareModel from '@models/share.model';
import zeltModel from '@models/zelt.model';
import zugangsschluesselModel from '@models/zugangsschluessel.model';
import { allRoutes } from '@routes/index';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const STRANGER_ID = '60706478aad6c9ad19a31c99';
const ZELT_ID = 'zelt-1';
const GERAET = 'controller-1';
const DING_ID = '6f1a8c3e-5d2b-4a7f-9c1e-0b2d4f6a8c1e';
const SEIT = Date.UTC(2026, 0, 1);

/**
 * Every route under /api/ and who is allowed through it. The app under test is
 * built from the application's own route list, so a route added anywhere and not
 * listed here fails the first test: an unguarded handler cannot reach production
 * unnoticed.
 *
 * `zelt` is the owner and only the owner. `lesen` is `darfLesen` - owner, share
 * link, read key or club key - and `schreiben` is `darfSchreiben`, which is the
 * owner or a club key. None of them is Express middleware, which is the whole
 * reason this table exists: the guard is a call a handler makes on its first
 * line, and a handler that forgets it is simply unguarded.
 *
 * A name in this table is a claim, so every class is exercised from both sides
 * further down: what the guard lets through matters as much as what it refuses,
 * and a table that only ever sees refusals would pass just as happily against a
 * handler that refuses everyone.
 *
 * `GET /api/zelte/:zelt_id` is `zelt` where §15.1 writes `Z | S | A`,
 * deliberately: the `Zelt` document is the device half - every binding with its
 * `seit` and `bis`, `kamera_leitgeraet`, the tent's own `d` - and a share link
 * is issued for one half of the tent, not for the record that lists the
 * hardware. What a reader legitimately needs from it (the name, `tag_null`, the
 * time zone) reaches them as the `zelt` art through `GET /api/dinge`, which is
 * narrowed per credential. Widening this route needs a `Lesegrund` of its own
 * and a projection to answer it with, and neither exists yet.
 */
const GUARDS: Record<string, 'session' | 'zelt' | 'lesen' | 'schreiben'> = {
  'GET /api/zelte': 'session',
  'GET /api/zelte/:zelt_id': 'zelt',
  'POST /api/zelte/:zelt_id/zugangsschluessel': 'zelt',
  'DELETE /api/zelte/:zelt_id/zugangsschluessel': 'zelt',
  'POST /api/zelte/:zelt_id/schluessel': 'zelt',
  'GET /api/zelte/:zelt_id/schluessel': 'zelt',
  'DELETE /api/schluessel/:schluessel_id': 'zelt',
  'GET /api/dinge': 'lesen',
  'POST /api/dinge': 'schreiben',
  'POST /api/dinge/stapel': 'schreiben',
  'PATCH /api/dinge/:ding_id': 'schreiben',
};

// The tent is named in the path on some routes and in the query or the body on
// others, so every probe carries it both ways.
const probe = (route: string): { method: string; url: string } => {
  const [method, path] = route.split(' ');
  const pfad = path.replace(':zelt_id', ZELT_ID).replace(':ding_id', DING_ID).replace(':schluessel_id', clubKeyId);

  return { method: method.toLowerCase(), url: `${pfad}?zelt_id=${ZELT_ID}` };
};

/** A body each write route accepts, so a positive probe fails on the guard and never on validation. */
const koerper = (route: string): Record<string, unknown> => {
  const gabe = { ding_id: randomUUID(), zelt_id: ZELT_ID, art: 'gabe', name: '', t: Date.now() - 3_600_000, d: { wasser_l: 2 } };

  if (route === 'POST /api/dinge') return gabe;
  if (route === 'POST /api/dinge/stapel') return { dinge: [gabe] };
  if (route === 'PATCH /api/dinge/:ding_id') return { t_ende: Date.now() };
  if (route === 'POST /api/zelte/:zelt_id/schluessel') return { mensch_ding_id: menschId };

  return {};
};

const makeToken = (user_id: string, is_demo = false) =>
  sign({ user_id, is_admin: false, is_demo, token_type: 'user', secret: 'test-secret' } as DataStoredInToken, SECRET_KEY, { expiresIn: '10m' });

const routeTable = (app: App): string[] => {
  const found: string[] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach(method => found.push(`${method.toUpperCase()} ${layer.route.path}`));
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app.getServer() as any)._router.stack);
  return found.filter(route => route.includes(' /api/'));
};

const routenMit = (klasse: string): string[] => Object.keys(GUARDS).filter(route => GUARDS[route] === klasse);

let mongo: MongoMemoryServer;
let app: App;
let apiKey: string;
let clubKey: string;
let clubKeyId: string;
let menschId: string;
let shareToken: string;

const baue = (routes: Routes[]): App => {
  const gebaut = new App(routes);
  (gebaut as any).initializeMiddlewares();
  (gebaut as any).initializeRoutes((gebaut as any).routes);
  (gebaut as any).initializeErrorHandling();
  return gebaut;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = baue(allRoutes());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

/**
 * One tent, one of every credential that reaches it. They are minted through
 * the endpoints that mint them rather than written into the collections, so a
 * positive probe below is answered by the same key an owner would have handed
 * out - a hash written by hand would prove only that this file and the service
 * agree on a hash.
 */
beforeEach(async () => {
  await Promise.all([
    zeltModel.deleteMany({}),
    dingModel.deleteMany({}),
    shareModel.deleteMany({}),
    schluesselModel.deleteMany({}),
    zugangsschluesselModel.deleteMany({}),
  ]);

  await zeltModel.create({
    zelt_id: ZELT_ID,
    besitzer_id: OWNER_ID,
    name: 'Zelt Keller',
    geraete: [{ geraet_id: GERAET, seit: SEIT }],
    zeitzone: 'Europe/Berlin',
    tag_null: SEIT,
    erstellt_at: SEIT,
  });
  // A tent of the stranger's own, so the refusals below are about this tent
  // rather than about an account with nothing in it.
  await zeltModel.create({
    zelt_id: 'zelt-fremd',
    besitzer_id: STRANGER_ID,
    name: 'Nebenan',
    geraete: [],
    zeitzone: 'Europe/Berlin',
    tag_null: SEIT,
    erstellt_at: SEIT,
  });

  // A PATCH resolves its Ding before it can know which tent to authorise
  // against, so the table's probes need one to resolve to.
  await dingModel.create({
    ding_id: DING_ID,
    zelt_id: ZELT_ID,
    art: 'zustand',
    name: '',
    t: Date.now() - 86_400_000,
    t_ende: null,
    d: { text: 'Trauermücken' },
  });
  const anna = await dingModel.create({
    ding_id: randomUUID(),
    zelt_id: ZELT_ID,
    art: 'mensch',
    name: 'Anna',
    t: SEIT,
    d: { farbe: '#7c3aed' },
  });

  menschId = anna.ding_id;

  const alsBesitzer = (aufruf: request.Test) => aufruf.set('Cookie', `Authorization=${makeToken(OWNER_ID)}`);
  apiKey = (await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/zugangsschluessel`)).expect(200)).body.token;
  const gemintet = (
    await alsBesitzer(request(app.getServer()).post(`/api/zelte/${ZELT_ID}/schluessel`).send({ mensch_ding_id: anna.ding_id })).expect(200)
  ).body;
  clubKey = gemintet.token;
  clubKeyId = gemintet.schluessel_id;

  shareToken = randomUUID();
  await shareModel.create({
    share_id: shareToken,
    owner_id: OWNER_ID,
    device_id: GERAET,
    page: 'diary',
    editable: false,
    webcam: false,
    charts: false,
    createdAt: Date.now(),
  });
});

describe('Zelt authorization', () => {
  it('declares a guard for every route under /api/', () => {
    expect(routeTable(app).sort()).toEqual(Object.keys(GUARDS).sort());
  });

  /**
   * The mechanism the first test rests on, exercised rather than assumed: a
   * route that reaches the app without an entry in the table has to be caught,
   * or the table proves nothing about the routes that are in it.
   */
  it('fails when a route arrives without declaring a guard', () => {
    const geschmuggelt: Routes = { router: Router() };
    geschmuggelt.router.get('/api/heimlich', (_req, res) => res.status(200).send('ok'));

    const mitSchmuggel = baue([...allRoutes(), geschmuggelt]);

    expect(routeTable(mitSchmuggel)).toContain('GET /api/heimlich');
    expect(routeTable(mitSchmuggel).sort()).not.toEqual(Object.keys(GUARDS).sort());
  });

  it('refuses every tent-scoped route to a logged-in stranger', async () => {
    const zeltRoutes = Object.keys(GUARDS).filter(route => GUARDS[route] !== 'session');
    expect(zeltRoutes.length).toBeGreaterThan(0);

    for (const route of zeltRoutes) {
      const { method, url } = probe(route);
      const response = await request(app.getServer())
        [method](url)
        .set('Cookie', `Authorization=${makeToken(STRANGER_ID)}`)
        .send(koerper(route));
      expect(`${route} -> ${response.status}`).toEqual(`${route} -> 403`);
    }
  });

  it('refuses every route under /api/ without a token', async () => {
    for (const route of Object.keys(GUARDS)) {
      const { method, url } = probe(route);
      const response = await request(app.getServer())[method](url).send(koerper(route));
      expect(`${route} -> ${response.status}`).toEqual(`${route} -> 401`);
    }
  });

  it('lets the owner read their tent', async () => {
    const response = await request(app.getServer())
      .get(`/api/zelte/${ZELT_ID}`)
      .set('Cookie', `Authorization=${makeToken(OWNER_ID)}`)
      .expect(200);
    expect(response.body.zelt_id).toEqual(ZELT_ID);
  });

  it('lists only the tents of the requesting user', async () => {
    const response = await request(app.getServer())
      .get('/api/zelte')
      .set('Cookie', `Authorization=${makeToken(OWNER_ID)}`)
      .expect(200);
    expect(response.body.map((zelt: any) => zelt.zelt_id)).toEqual([ZELT_ID]);
  });

  it('refuses a demo session a tent it does not own', async () => {
    await request(app.getServer())
      .get(`/api/zelte/${ZELT_ID}`)
      .set('Cookie', `Authorization=${makeToken(OWNER_ID, true)}`)
      .expect(403);
  });
});

/**
 * The other half of the table. `lesen` and `schreiben` name credentials that
 * are not sessions, and nothing above would notice if the guard had stopped
 * accepting them - or, worse, if `schreiben` had started accepting the read
 * key, which is the one credential explicitly minted to be pasted into other
 * people's scripts.
 */
describe('what each guard class actually lets through', () => {
  const alsBesitzer = (aufruf: request.Test) => aufruf.set('Cookie', `Authorization=${makeToken(OWNER_ID)}`);

  it('answers every read route to the read key and to a diary link', async () => {
    expect(routenMit('lesen').length).toBeGreaterThan(0);

    for (const route of routenMit('lesen')) {
      const { method, url } = probe(route);
      const mitApiKey = await request(app.getServer())[method](url).set('x-api-key', apiKey);
      expect(`${route} x-api-key -> ${mitApiKey.status}`).toEqual(`${route} x-api-key -> 200`);

      const mitShare = await request(app.getServer())[method](`${url}&share=${shareToken}`);
      expect(`${route} share -> ${mitShare.status}`).toEqual(`${route} share -> 200`);
    }
  });

  it('answers every write route to a club key and to no read key', async () => {
    expect(routenMit('schreiben').length).toBeGreaterThan(0);

    for (const route of routenMit('schreiben')) {
      const { method, url } = probe(route);
      const mitApiKey = await request(app.getServer())[method](url).set('x-api-key', apiKey).send(koerper(route));
      expect(`${route} x-api-key -> ${mitApiKey.status}`).toEqual(`${route} x-api-key -> 403`);

      const mitClubKey = await request(app.getServer())[method](url).set('X-Schluessel', clubKey).send(koerper(route));
      expect(`${route} Schlüssel -> ${mitClubKey.status}`).toEqual(`${route} Schlüssel -> 200`);
    }
  });

  it('answers every owner-only route to the owner and to no key at all', async () => {
    for (const route of routenMit('zelt')) {
      const { method, url } = probe(route);
      // A key of this very tent, on a route the owner keeps: minting and
      // revoking credentials is not something a credential may do.
      for (const [name, aufruf] of [
        ['x-api-key', request(app.getServer())[method](url).set('x-api-key', apiKey)],
        ['Schlüssel', request(app.getServer())[method](url).set('X-Schluessel', clubKey)],
        ['share', request(app.getServer())[method](`${url}&share=${shareToken}`)],
      ] as [string, request.Test][]) {
        const response = await aufruf.send(koerper(route));
        expect(`${route} ${name} -> ${response.status >= 400}`).toEqual(`${route} ${name} -> true`);
      }

      // The same route, with the session it was written for.
      const alsEigner = await alsBesitzer(request(app.getServer())[method](url)).send(koerper(route));
      expect(`${route} owner -> ${alsEigner.status}`).toEqual(`${route} owner -> 200`);
    }
  });
});
