import type { DateTime } from 'luxon';
import type { Camera, ValueState } from '@fg2/shared-types/v1';
import { CAMERA_STILLS } from '@fg2/shared-types/v1-schemas/value-age.js';

/**
 * How late a camera's last picture is, by the stills it has missed. A camera
 * that has never delivered is offline rather than absent, and its row keeps
 * saying so.
 */
export const cameraFreshness = (camera: Camera, now: DateTime): ValueState => {
  if (!camera.state.lastStillAt) return 'offline';

  const missed = (now.toMillis() - Date.parse(camera.state.lastStillAt)) / 1000 / Math.max(1, camera.stillIntervalSeconds);
  if (missed <= CAMERA_STILLS.staleAfter) return 'live';

  return missed <= CAMERA_STILLS.offlineAfter ? 'stale' : 'offline';
};

/**
 * Whether the account has a camera of its own: one that is not a tombstone and
 * not the demo's. What exists only for a camera - Premium, the weekly film - is
 * offered on this and left out without it.
 */
export const ownsCamera = (cameras: Camera[]): boolean => cameras.some(camera => camera.removedAt === null && !camera.isDemo);
