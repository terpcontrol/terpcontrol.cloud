import type { DateTime } from 'luxon';
import type { Camera, ValueState } from '@fg2/shared-types/v1';

/**
 * How late a camera's last picture is.
 *
 * A reading is live for two minutes because that is how often a device reports;
 * a camera reports every `stillIntervalSeconds`, which a person sets, so it is
 * judged against its own promise instead: two pictures missed is stale, ten is
 * a camera that has stopped. A camera that has never delivered is offline
 * rather than absent, and its row keeps saying so.
 */
const STALE_AFTER_STILLS = 2;
const OFFLINE_AFTER_STILLS = 10;

export const cameraFreshness = (camera: Camera, now: DateTime): ValueState => {
  if (!camera.state.lastStillAt) return 'offline';

  const missed = (now.toMillis() - Date.parse(camera.state.lastStillAt)) / 1000 / Math.max(1, camera.stillIntervalSeconds);
  if (missed <= STALE_AFTER_STILLS) return 'live';

  return missed <= OFFLINE_AFTER_STILLS ? 'stale' : 'offline';
};
