import { logger } from '@utils/logger';

/**
 * The timers a service keeps between requests - the pollers that read cameras,
 * roll up timelapses and hand out firmware upgrades.
 *
 * They are held together for two reasons. Shutting down has to really stop
 * them: each of these loops re-arms itself when it finishes, so clearing the
 * timer that happens to be pending is not enough - the one it was about to
 * create has to be refused as well.
 *
 * And a failure has to stay inside the loop it happened in. There is no caller
 * to return an error to on a timer, so a rejected promise would reach the
 * handler in `main.ts`, which ends the process - one failed query taking the
 * whole API down with it.
 */
export class BackgroundWork {
  private stopped = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  public get isStopped(): boolean {
    return this.stopped;
  }

  /** Runs the work once, after the delay, unless the server is on its way down. */
  public schedule(name: string, work: () => void | Promise<unknown>, delayMs: number): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.run(name, work);
    }, delayMs);

    this.timers.add(timer);
  }

  /** Runs the work on every interval until the server stops. */
  public repeat(name: string, work: () => void | Promise<unknown>, everyMs: number): void {
    if (this.stopped) return;

    this.timers.add(setInterval(() => this.run(name, work), everyMs));
  }

  public stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Runs the work now, keeping a failure inside it rather than ending the process. */
  public run(name: string, work: () => void | Promise<unknown>): void {
    if (this.stopped) return;

    try {
      const result = work();
      if (result instanceof Promise) {
        result.catch(error => logger.error(`${name} failed: ${error instanceof Error ? error.stack ?? error.message : error}`));
      }
    } catch (error) {
      logger.error(`${name} failed: ${error instanceof Error ? error.stack ?? error.message : error}`);
    }
  }
}
