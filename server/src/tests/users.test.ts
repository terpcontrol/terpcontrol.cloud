import request from 'supertest';
import { sign } from 'jsonwebtoken';
import App from '@/app';
import { SECRET_KEY } from '@config';
import { DataStoredInToken } from '@interfaces/auth.interface';
import UsersRoute from '@routes/users.route';

const appWith = (routes: any[]): App => {
  const app = new App(routes);
  (app as any).initializeMiddlewares();
  (app as any).initializeRoutes(routes);
  (app as any).initializeErrorHandling();
  return app;
};

const token = (is_admin: boolean) =>
  sign({ user_id: 'u1', is_admin, is_demo: false, token_type: 'user', secret: 's' } as DataStoredInToken, SECRET_KEY, { expiresIn: '10m' });

describe('Users', () => {
  let route: UsersRoute;
  let app: App;

  beforeEach(() => {
    route = new UsersRoute();
    app = appWith([route]);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists users for an admin', async () => {
    const users = [
      { _id: 'a', username: 'anna', is_admin: false },
      { _id: 'b', username: 'ben', is_admin: true },
    ];
    route.usersController.userService.findAllUser = jest.fn().mockResolvedValue(users) as never;

    const response = await request(app.getServer())
      .get('/users')
      .set('Authorization', `Bearer ${token(true)}`)
      .expect(200);
    expect(response.body.map((u: { username: string }) => u.username)).toEqual(['anna', 'ben']);
  });

  it('refuses the list to an ordinary account', () => {
    return request(app.getServer())
      .get('/users')
      .set('Authorization', `Bearer ${token(false)}`)
      .expect(401);
  });

  it('refuses the list without a token at all', () => {
    return request(app.getServer()).get('/users').expect(401);
  });

  it('rejects a new user with no password', () => {
    return request(app.getServer())
      .post('/users')
      .set('Authorization', `Bearer ${token(true)}`)
      .send({ username: 'anna' })
      .expect(400);
  });
});
