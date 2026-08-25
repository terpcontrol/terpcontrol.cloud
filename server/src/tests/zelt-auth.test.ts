import mongoose from 'mongoose';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import zeltModel from '@models/zelt.model';
import ZeltRoute from '@routes/zelt.route';

const OWNER_ID = '60706478aad6c9ad19a31c84';
const STRANGER_ID = '60706478aad6c9ad19a31c99';
const ZELT_ID = 'zelt-1';

// Every route under /api/ and who is allowed through it. A new route that is
// not listed here fails the first test, which is the point: an unguarded
// handler cannot reach production unnoticed.
const GUARDS: Record<string, 'session' | 'zelt'> = {
  'GET /api/zelte': 'session',
  'GET /api/zelte/:zelt_id': 'zelt',
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
    app = new App([new ZeltRoute()]);
    (app as any).initializeMiddlewares();
    (app as any).initializeRoutes((app as any).routes);
    (app as any).initializeErrorHandling();

    zeltModel.exists = jest
      .fn()
      .mockImplementation((filter: any) => (filter.zelt_id === ZELT_ID && filter.besitzer_id === OWNER_ID ? { _id: 'x' } : null));
    const zelt = { zelt_id: ZELT_ID, besitzer_id: OWNER_ID, name: 'Zelt Keller', geraete: [], tag_null: 1, erstellt_at: 1 };
    zeltModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([zelt]) }) as any;
    zeltModel.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(zelt) }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('declares a guard for every route under /api/', () => {
    expect(routeTable(app).sort()).toEqual(Object.keys(GUARDS).sort());
  });

  it('refuses every tent-scoped route to a logged-in stranger', async () => {
    const zeltRoutes = Object.keys(GUARDS).filter(route => GUARDS[route] === 'zelt');
    expect(zeltRoutes.length).toBeGreaterThan(0);

    for (const route of zeltRoutes) {
      const [method, path] = route.split(' ');
      const response = await request(app.getServer())
        [method.toLowerCase()](path.replace(':zelt_id', ZELT_ID))
        .set('Cookie', `Authorization=${makeToken(STRANGER_ID)}`);
      expect(`${route} -> ${response.status}`).toEqual(`${route} -> 403`);
    }
  });

  it('refuses every route under /api/ without a token', async () => {
    for (const route of Object.keys(GUARDS)) {
      const [method, path] = route.split(' ');
      const response = await request(app.getServer())[method.toLowerCase()](path.replace(':zelt_id', ZELT_ID));
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
