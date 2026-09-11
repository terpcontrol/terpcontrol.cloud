import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Model } from 'mongoose';
import { HttpException } from '@common/http-exception';
import { MODEL } from '@database/models';
import { RateLimitWindow } from '@database/schemas/rate-limit.schema';
import { logger } from '@utils/logger';

export interface RateLimit {
  /** Requests allowed per window, per client address. */
  limit: number;
  windowMs: number;
  /** What the caller is told once the budget is spent. */
  message: string;
}

const RATE_LIMIT = 'rate-limit';

export const RateLimited = (limit: RateLimit) => SetMetadata(RATE_LIMIT, limit);

/** A window as the guard reads it, whichever counter it came from. */
interface Window {
  count: number;
  resetAt: number;
}

const DUPLICATE_KEY = 11000;

/**
 * A fixed window per client address and route.
 *
 * The counter lives in the database because a deployment serves one address
 * from several server processes - the pm2 configuration runs a cluster - and a
 * counter in each of them lets a client spend the budget once per process
 * simply by spreading its requests. The limits these decorate are small
 * enough for that to matter: a handful of login or password-reset attempts a
 * minute is the difference between throttling a brute-force attempt and
 * halving the time it takes.
 *
 * Where the store cannot be reached the request is counted in this process
 * instead, which is what the limiter did before it had one. A database that is
 * down then costs the limit its exactness rather than its existence - and the
 * routes it guards need the same database to answer at all.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  constructor(
    private readonly reflector: Reflector,
    @InjectModel(MODEL.rateLimit) private readonly sharedWindows: Model<RateLimitWindow>,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<RateLimit>(RATE_LIMIT, [context.getHandler(), context.getClass()]);
    if (!config) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const now = Date.now();
    const key = `${context.getClass().name}.${context.getHandler().name}:${request.ip}`;
    const window = await this.count(key, config, now);

    void reply.header('RateLimit-Limit', config.limit);
    void reply.header('RateLimit-Remaining', Math.max(0, config.limit - window.count));
    void reply.header('RateLimit-Reset', Math.ceil((window.resetAt - now) / 1000));

    if (window.count > config.limit) {
      void reply.header('Retry-After', Math.ceil((window.resetAt - now) / 1000));
      throw new HttpException(429, config.message);
    }

    return true;
  }

  /** Counts the request where every process can see it, or failing that here. */
  private async count(key: string, config: RateLimit, now: number): Promise<Window> {
    try {
      return await this.countShared(key, config, now);
    } catch (error) {
      logger.error(`Rate limit store unreachable, counting ${key} in this process alone: ${error}`);
      return this.countHere(key, config, now);
    }
  }

  private async countShared(key: string, config: RateLimit, now: number): Promise<Window> {
    try {
      return await this.spendWindow(key, config, now);
    } catch (error) {
      // Two processes racing to open the same window leave the loser holding a
      // duplicate key - and by the time it is told so, the window it wanted is
      // there for it to increment.
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      return this.spendWindow(key, config, now);
    }
  }

  /**
   * One document per window, incremented in place. Both stages read the
   * `resetAt` the request arrived at - neither reads what the other writes - so
   * concurrent requests cannot lose a count between them, and a window that has
   * run out is replaced rather than continued.
   */
  private async spendWindow(key: string, config: RateLimit, now: number): Promise<Window> {
    const at = new Date(now);
    // Whether the request falls into a window that is still open. A document the
    // upsert has just invented carries no `resetAt`, and this instant is not
    // later than itself, so a request that finds no window opens one.
    const running = { $gt: [{ $ifNull: ['$resetAt', at] }, at] };

    const window = await this.sharedWindows
      .findOneAndUpdate(
        { _id: key },
        [
          { $set: { count: { $cond: [running, { $add: ['$count', 1] }, 1] } } },
          { $set: { resetAt: { $cond: [running, '$resetAt', new Date(now + config.windowMs)] } } },
        ],
        { upsert: true, new: true, lean: true },
      )
      .exec();

    return { count: window.count, resetAt: window.resetAt.getTime() };
  }

  /** The per-process fallback: exact for this worker, blind to the others. */
  private countHere(key: string, config: RateLimit, now: number): Window {
    this.sweep(now);

    const window = this.windows.get(key);
    const current = !window || window.resetAt <= now ? { count: 0, resetAt: now + config.windowMs } : window;

    current.count += 1;
    this.windows.set(key, current);

    return current;
  }

  /** Drops windows that have run out, so a long uptime cannot grow the map without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;

    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
