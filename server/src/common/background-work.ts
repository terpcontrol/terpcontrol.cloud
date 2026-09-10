import { logger } from '@utils/logger';

const describe = (error: unknown): string => (error instanceof Error ? error.stack ?? error.message : String(error));

/**
 * For work started where there is no caller to return a failure to - inside a
 * callback, a stream handler, a timer. A promise dropped on the floor there
 * reaches the handler in `main.ts`, which ends the process; naming it here says
 * what failed instead.
 */
export const logIfItFails = (name: string, work: Promise<unknown>): void => {
  work.catch(error => logger.error(`${name} failed: ${describe(error)}`));
};

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

  /**
   * Runs the work on every interval until the server stops - one pass at a
   * time. A pass that is still going holds the next tick off rather than
   * running beside itself: these walk every device and await as they go, so two
   * of them read the same rows and each acts on them - a grow plan advanced
   * twice with two mails, or twice as many devices sent a firmware upgrade as
   * the class allows at once.
   */
  public repeat(name: string, work: () => void | Promise<unknown>, everyMs: number): void {
    if (this.stopped) return;

    let running = false;
    const finished = () => (running = false);

    this.timers.add(
      setInterval(() => {
        if (running) return;

        running = true;
        const result = this.run(name, work);
        if (result) void result.finally(finished);
        else finished();
      }, everyMs),
    );
  }

  public stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Runs the work now, keeping a failure inside it rather than ending the
   * process. Answers with the work in flight, for a caller that has to know
   * when it is done.
   */
  public run(name: string, work: () => void | Promise<unknown>): Promise<unknown> | undefined {
    if (this.stopped) return undefined;

    try {
      const result = work();
      if (result instanceof Promise) {
        return result.catch(error => logger.error(`${name} failed: ${describe(error)}`));
      }
    } catch (error) {
      logger.error(`${name} failed: ${describe(error)}`);
    }

    return undefined;
  }
}
