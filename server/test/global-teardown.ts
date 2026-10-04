/**
 * How long the run may take to end on its own once the harness has stopped. A
 * green run is done well within it; jest warns after a second that something is
 * still open.
 */
const WIND_DOWN_MS = 5_000;

export default async (globalConfig: { watch: boolean; watchAll: boolean }): Promise<void> => {
  const teardown = (globalThis as Record<string, unknown>).__HARNESS_TEARDOWN__ as (() => Promise<void>) | undefined;
  if (teardown) await teardown();

  // A spec that fails before closing its MQTT client, child process or database
  // connection leaves it open, and the run would wait on it for good. jest's
  // forceExit ends that, but says so on every run, green or red. This ends it
  // only when something is left, after jest has said what to look for; it
  // does not keep a run alive that has nothing left to do. Under --watch the
  // teardown follows every pass, and the watcher is what keeps the process
  // alive on purpose.
  if (globalConfig.watch || globalConfig.watchAll) return;
  setTimeout(() => process.exit(), WIND_DOWN_MS).unref();
};
