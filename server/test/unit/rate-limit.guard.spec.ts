import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Model } from 'mongoose';
import { HttpException } from '@common/http-exception';
import { RateLimit, RateLimitGuard } from '@common/rate-limit.guard';
import { RateLimitWindow } from '@database/schemas/rate-limit.schema';
import { startTestDatabase, TestDatabase } from './support/database';

/**
 * The guard counts requests for a deployment that serves one address from
 * several server processes, so what matters about it is what no single process
 * can see. The black-box suite drives one process and would agree with a
 * counter that lives in it; here two guards are constructed side by side, as
 * the workers of a cluster are, and made to share one database.
 */

const CLIENT = '203.0.113.7';
const LOGIN: RateLimit = { limit: 10, windowMs: 60_000, message: 'Too many login attempts, please try again later.' };

/** What the key is built from: the controller, the route and the address. */
class AuthController {}
const logIn = function logIn() {};
const getPasswordToken = function getPasswordToken() {};

let db: TestDatabase;

const aGuard = (config: RateLimit = LOGIN, store: Model<RateLimitWindow> = db.rateLimitWindows) =>
  new RateLimitGuard({ getAllAndOverride: () => config } as unknown as Reflector, store);

interface Answer {
  allowed: boolean;
  status?: number;
  message?: string;
  headers: Record<string, number>;
}

/** One request through the guard, with whatever it set on the reply. */
const call = async (guard: RateLimitGuard, ip = CLIENT, route = logIn): Promise<Answer> => {
  const headers: Record<string, number> = {};
  const context = {
    getClass: () => AuthController,
    getHandler: () => route,
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => ({
        header: (name: string, value: number) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;

  try {
    await guard.canActivate(context);
    return { allowed: true, headers };
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { allowed: false, status: error.status, message: error.message, headers };
  }
};

/** Spends `times` requests and answers whether every one of them was allowed. */
const spend = async (guard: RateLimitGuard, times: number, ip = CLIENT, route = logIn): Promise<boolean> => {
  const answers: Answer[] = [];
  for (let i = 0; i < times; i++) answers.push(await call(guard, ip, route));
  return answers.every(answer => answer.allowed);
};

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
});

it('counts a client across the processes that serve it', async () => {
  const [worker, otherWorker] = [aGuard(), aGuard()];

  // Alternating, which is what a client gets from a load balancer in front of
  // a cluster - and what used to buy it the budget once per process.
  for (let attempt = 0; attempt < LOGIN.limit; attempt++) {
    expect((await call(attempt % 2 === 0 ? worker : otherWorker)).allowed).toBe(true);
  }

  const refused = await call(otherWorker);
  expect(refused.allowed).toBe(false);
  expect(refused.status).toBe(429);
  expect(refused.message).toBe(LOGIN.message);
});

it('spends one budget however many processes serve the requests', async () => {
  const workers = [aGuard(), aGuard(), aGuard()];

  const allowed: number[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await call(workers[attempt % workers.length])).allowed) allowed.push(attempt);
  }

  expect(allowed).toHaveLength(LOGIN.limit);
});

it('loses no request to another arriving at the same moment', async () => {
  const [worker, otherWorker] = [aGuard(), aGuard()];

  // All at once rather than one after the other: a counter that reads a window
  // and writes it back would let some of these overwrite each other.
  const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 === 0 ? worker : otherWorker)));

  expect(answers.filter(answer => answer.allowed)).toHaveLength(LOGIN.limit);
});

it('refuses the request after the last one the limit allows', async () => {
  const guard = aGuard();

  expect(await spend(guard, LOGIN.limit)).toBe(true);
  expect((await call(guard)).allowed).toBe(false);
});

it('keeps a budget per client address', async () => {
  const [worker, otherWorker] = [aGuard(), aGuard()];

  expect(await spend(worker, LOGIN.limit)).toBe(true);
  expect((await call(otherWorker, '198.51.100.4')).allowed).toBe(true);
});

it('keeps a budget per route', async () => {
  const [worker, otherWorker] = [aGuard(), aGuard()];

  expect(await spend(worker, LOGIN.limit)).toBe(true);
  expect((await call(otherWorker, CLIENT, getPasswordToken)).allowed).toBe(true);
});

it('tells the caller what it has left and when to come back', async () => {
  const guard = aGuard();

  const first = await call(guard);
  expect(first.headers['RateLimit-Limit']).toBe(LOGIN.limit);
  expect(first.headers['RateLimit-Remaining']).toBe(LOGIN.limit - 1);
  expect(first.headers['RateLimit-Reset']).toBe(60);

  await spend(guard, LOGIN.limit - 1);
  const refused = await call(aGuard());
  expect(refused.headers['RateLimit-Remaining']).toBe(0);
  expect(refused.headers['Retry-After']).toBeGreaterThan(0);
});

it('starts a new window once the old one has run out', async () => {
  const short: RateLimit = { ...LOGIN, limit: 2, windowMs: 200 };
  const [worker, otherWorker] = [aGuard(short), aGuard(short)];

  expect(await spend(worker, 2)).toBe(true);
  expect((await call(otherWorker)).allowed).toBe(false);

  await new Promise(resolve => setTimeout(resolve, 250));
  expect(await spend(otherWorker, 2)).toBe(true);
});

it('falls back to counting in this process where the store cannot be reached', async () => {
  const unreachable = {
    findOneAndUpdate: () => ({ exec: () => Promise.reject(new Error('no database')) }),
  } as unknown as Model<RateLimitWindow>;
  const guard = aGuard(LOGIN, unreachable);

  expect(await spend(guard, LOGIN.limit)).toBe(true);
  expect((await call(guard)).allowed).toBe(false);
});
