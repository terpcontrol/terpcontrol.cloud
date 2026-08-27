import { randomBytes, randomInt } from 'node:crypto';
import supertest from 'supertest';
import { readContext } from './context';

export const context = readContext();

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * The API rate-limits per client IP and trusts one proxy hop, so every client
 * gets its own X-Forwarded-For. Without that, unrelated specs would exhaust
 * each other's login and signup budgets.
 */
const randomIp = (): string => `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`;

export const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`;

export class ApiClient {
  constructor(public readonly ip: string = randomIp(), public token?: string) {}

  public request(method: Method, path: string): supertest.Test {
    const test = supertest(context.baseUrl)[method](path).set('X-Forwarded-For', this.ip);
    return this.token ? test.set('Authorization', `Bearer ${this.token}`) : test;
  }

  public get = (path: string) => this.request('get', path);
  public post = (path: string) => this.request('post', path);
  public put = (path: string) => this.request('put', path);
  public delete = (path: string) => this.request('delete', path);

  public as(token: string): ApiClient {
    return new ApiClient(this.ip, token);
  }
}

export const anonymous = (): ApiClient => new ApiClient();

export interface Session {
  client: ApiClient;
  username: string;
  password: string;
  userId: string;
  userToken: string;
  refreshToken: string;
  imageToken: string;
  isAdmin: boolean;
}

export const login = async (username: string, password: string, stayLoggedIn?: boolean): Promise<Session> => {
  const client = anonymous();
  const body: Record<string, unknown> = { username, password };
  if (stayLoggedIn !== undefined) body.stayLoggedIn = stayLoggedIn;

  const response = await client.post('/login').send(body).expect(200);

  return {
    client: client.as(response.body.userToken.token),
    username,
    password,
    userId: response.body.user.user_id,
    userToken: response.body.userToken.token,
    refreshToken: response.body.refreshToken.token,
    imageToken: response.body.imageToken.token,
    isAdmin: !!response.body.user.is_admin,
  };
};

/** A fresh, activated, non-admin account. */
export const createAccount = async (prefix = 'user'): Promise<Session> => {
  const username = `${unique(prefix)}@test.invalid`;
  const password = 'Passw0rd!test';

  await anonymous().post('/signup').send({ username, password }).expect(201);
  return login(username, password);
};

export const loginAsAdmin = (): Promise<Session> => login(context.admin.username, context.admin.password);

/** A demo session: no account, read-only, and only sees demo devices. */
export const demoSession = async (): Promise<Session> => {
  const client = anonymous();
  const response = await client.post('/demologin').expect(200);

  return {
    client: client.as(response.body.userToken.token),
    username: 'demo',
    password: '',
    userId: response.body.user.user_id,
    userToken: response.body.userToken.token,
    refreshToken: response.body.refreshToken.token,
    imageToken: response.body.imageToken.token,
    isAdmin: false,
  };
};
