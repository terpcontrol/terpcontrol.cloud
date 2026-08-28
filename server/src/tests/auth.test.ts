import { hash } from 'bcrypt';
import request from 'supertest';
import App from '@/app';
import AuthRoute from '@routes/auth.route';
import userModel from '@models/users.model';

const appWith = (routes: any[]): App => {
  const app = new App(routes);
  (app as any).initializeMiddlewares();
  (app as any).initializeRoutes(routes);
  (app as any).initializeErrorHandling();
  return app;
};

describe('Auth', () => {
  let app: App;

  beforeEach(() => {
    app = appWith([new AuthRoute()]);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses a signup that carries no password', () => {
    return request(app.getServer()).post('/signup').send({ username: 'anna' }).expect(400);
  });

  it('refuses a signup for a username that is taken', () => {
    userModel.findOne = jest.fn().mockResolvedValue({ username: 'anna' }) as never;
    return request(app.getServer()).post('/signup').send({ username: 'anna', password: 'geheim123' }).expect(409);
  });

  it('refuses a login with the wrong password', async () => {
    userModel.findOne = jest.fn().mockResolvedValue({
      username: 'anna',
      user_id: 'u1',
      is_admin: false,
      is_active: true,
      password: await hash('richtig123', 10),
    }) as never;

    return request(app.getServer()).post('/login').send({ username: 'anna', password: 'falsch123' }).expect(409);
  });

  // Signing up currently leaves the account inactive until the emailed code is
  // used, and login refuses it until then.
  it('refuses a login for an account that was never activated', async () => {
    userModel.findOne = jest.fn().mockResolvedValue({
      username: 'anna',
      user_id: 'u1',
      is_admin: false,
      is_active: false,
      password: await hash('geheim123', 10),
    }) as never;

    return request(app.getServer()).post('/login').send({ username: 'anna', password: 'geheim123' }).expect(409);
  });

  it('refuses a login for a username nobody has', () => {
    userModel.findOne = jest.fn().mockResolvedValue(null) as never;
    return request(app.getServer()).post('/login').send({ username: 'niemand', password: 'geheim123' }).expect(409);
  });
});
