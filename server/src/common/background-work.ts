/**
 * The timers a service keeps between requests - the pollers that read cameras,
 * roll up timelapses and hand out firmware upgrades.
 *
 * They are held together so that shutting down really stops them: each of these
 * loops re-arms itself when it finishes, so clearing the timer that happens to
 * be pending is not enough - the one it was about to create has to be refused
 * as well. A timer left running keeps querying a database the server is in the
 * middle of disconnecting from, and keeps the process alive after it was asked
 * to stop.
 */
export class BackgroundWork {
  private stopped = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  public get isStopped(): boolean {
    return this.stopped;
  }

  /** Runs the work once, after the delay, unless the server is on its way down. */
  public schedule(work: () => void, delayMs: number): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) work();
    }, delayMs);

    this.timers.add(timer);
  }

  /** Runs the work on every interval until the server stops. */
  public repeat(work: () => void, everyMs: number): void {
    if (this.stopped) return;

    const timer = setInterval(() => {
      if (!this.stopped) work();
    }, everyMs);

    this.timers.add(timer);
  }

  public stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
