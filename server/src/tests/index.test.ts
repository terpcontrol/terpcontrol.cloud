import request from 'supertest';
import App from '@/app';
import IndexRoute from '@routes/index.route';
import userModel from '@models/users.model';

// Routes are wired in run(), which also opens a database connection and binds a
// port. Tests want the routes without either, so they are initialised directly.
const appWith = (routes: any[]): App => {
  const app = new App(routes);
  (app as any).initializeMiddlewares();
  (app as any).initializeRoutes(routes);
  (app as any).initializeErrorHandling();
  return app;
};

describe('Index', () => {
  const app = () => appWith([new IndexRoute()]);

  afterEach(() => jest.restoreAllMocks());

  it('answers the health check without touching the database', () => {
    return request(app().getServer()).get('/').expect(200);
  });

  it('reports ready once the admin account exists', () => {
    userModel.findOne = jest.fn().mockResolvedValue({ username: 'admin' }) as never;
    return request(app().getServer()).get('/readycheck').expect(200);
  });

  it('reports not ready while the admin account is still missing', () => {
    userModel.findOne = jest.fn().mockResolvedValue(null) as never;
    return request(app().getServer()).get('/readycheck').expect(501);
  });

  it('has nothing to say about an unknown path', () => {
    return request(app().getServer()).get('/keine-ahnung').expect(404);
  });
});
