import { Router } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import { Routes } from '@interfaces/routes.interface';
import dingModel from '@models/ding.model';
import zeltModel from '@models/zelt.model';
import { allRoutes } from '@routes/index';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const STRANGER_ID = '60706478aad6c9ad19a31c99';
const ZELT_ID = 'zelt-1';
const DING_ID = '6f1a8c3e-5d2b-4a7f-9c1e-0b2d4f6a8c1e';

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
 */
const GUARDS: Record<string, 'session' | 'zelt' | 'lesen' | 'schreiben'> = {
  'GET /api/zelte': 'session',
  'GET /api/zelte/:zelt_id': 'zelt',
  'POST /api/zelte/:zelt_id/zugangsschluessel': 'zelt',
  'POST /api/zelte/:zelt_id/schluessel': 'zelt',
  'GET /api/dinge': 'lesen',
  'POST /api/dinge': 'schreiben',
  'POST /api/dinge/stapel': 'schreiben',
  'PATCH /api/dinge/:ding_id': 'schreiben',
};

// The tent is named in the path on some routes and in the query or the body on
// others, so every probe carries it both ways.
const probe = (route: string): { method: string; url: string } => {
  const [method, path] = route.split(' ');
  return { method: method.toLowerCase(), url: `${path.replace(':zelt_id', ZELT_ID).replace(':ding_id', DING_ID)}?zelt_id=${ZELT_ID}` };
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

afterAll(async () => {
  await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
});

describe('Zelt authorization', () => {
  let app: App;

  beforeEach(() => {
    (mongoose as any).connect = jest.fn();
    app = new App(allRoutes());
    (app as any).initializeMiddlewares();
    (app as any).initializeRoutes((app as any).routes);
    (app as any).initializeErrorHandling();

    zeltModel.exists = jest
      .fn()
      .mockImplementation((filter: any) => (filter.zelt_id === ZELT_ID && filter.besitzer_id === OWNER_ID ? { _id: 'x' } : null));
    const zelt = { zelt_id: ZELT_ID, besitzer_id: OWNER_ID, name: 'Zelt Keller', geraete: [], tag_null: 1, erstellt_at: 1 };
    zeltModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([zelt]) }) as any;
    zeltModel.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(zelt) }) as any;
    // A PATCH resolves its Ding before it can know which tent to authorise
    // against, so the table's probes need one to resolve to.
    dingModel.findOne = jest
      .fn()
      .mockReturnValue({ lean: () => Promise.resolve({ ding_id: DING_ID, zelt_id: ZELT_ID, art: 'zustand', name: '', t: 1 }) }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

    const mitSchmuggel = new App([...allRoutes(), geschmuggelt]);
    (mitSchmuggel as any).initializeMiddlewares();
    (mitSchmuggel as any).initializeRoutes((mitSchmuggel as any).routes);

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
        .set('Cookie', `Authorization=${makeToken(STRANGER_ID)}`);
      expect(`${route} -> ${response.status}`).toEqual(`${route} -> 403`);
    }
  });

  it('refuses every route under /api/ without a token', async () => {
    for (const route of Object.keys(GUARDS)) {
      const { method, url } = probe(route);
      const response = await request(app.getServer())[method](url);
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
    await request(app.getServer())
      .get('/api/zelte')
      .set('Cookie', `Authorization=${makeToken(OWNER_ID)}`)
      .expect(200);
    expect(zeltModel.find).toHaveBeenCalledWith({ besitzer_id: OWNER_ID }, expect.anything());
  });

  it('refuses a demo session a tent it does not own', async () => {
    await request(app.getServer())
      .get(`/api/zelte/${ZELT_ID}`)
      .set('Cookie', `Authorization=${makeToken(OWNER_ID, true)}`)
      .expect(403);
  });
});
