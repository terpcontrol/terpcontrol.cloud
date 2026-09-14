import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { HttpException } from '@common/http-exception';

export interface RateLimit {
  /** Requests allowed per window, per client address. */
  limit: number;
  windowMs: number;
  /** What the caller is told once the budget is spent. */
  message: string;
}

const RATE_LIMIT = 'rate-limit';

export const RateLimited = (limit: RateLimit) => SetMetadata(RATE_LIMIT, limit);

interface Window {
  count: number;
  resetAt: number;
}

/**
 * A fixed window per client address and route, in memory.
 *
 * In memory is what the Express limiter did too, and it is exact as the server
 * is deployed: `docker-compose.yaml` declares one `server` service with no
 * replicas, and its image runs `node dist/main.js` - one process, so every
 * request a client makes is counted in the same map and the budget a route
 * declares is the budget it gets.
 *
 * Serving the API from more than one process is what would break that: a second
 * replica, a `deploy.replicas`, or a cluster of workers would each count only
 * the requests they served, and holding the limits would then need a shared
 * store - a counter keyed the same way, incremented atomically, expiring with
 * the window.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.getAllAndOverride<RateLimit>(RATE_LIMIT, [context.getHandler(), context.getClass()]);
    if (!config) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const now = Date.now();
    this.sweep(now);

    const key = `${context.getClass().name}.${context.getHandler().name}:${request.ip}`;
    const window = this.windows.get(key);
    const current = !window || window.resetAt <= now ? { count: 0, resetAt: now + config.windowMs } : window;

    current.count += 1;
    this.windows.set(key, current);

    void reply.header('RateLimit-Limit', config.limit);
    void reply.header('RateLimit-Remaining', Math.max(0, config.limit - current.count));
    void reply.header('RateLimit-Reset', Math.ceil((current.resetAt - now) / 1000));

    if (current.count > config.limit) {
      void reply.header('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      throw new HttpException(429, config.message);
    }

    return true;
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
