import type { GrowthStage } from '@fg2/shared-types/v1';

/**
 * The stage-bound alarm thresholds: the bands of the climate a place was put on.
 *
 * The rules themselves belong to the alarm engine, which owns `alarmRules` and
 * the `presetId` a stage writes its rules under; the writer of a device's
 * settings says which climate it wrote, and the device placement which place a
 * device now stands in.
 *
 * Optional, like every port between two slices here: until something is bound to
 * this token a climate is still written and a grow still moves on, and the rules
 * of the device simply stay as they were.
 */
export interface StageAlarms {
  /** Writes, updates or removes the rules this stage and preset imply for the device. */
  applyStage(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void>;
  /** The rules of this climate on every device standing where this one stands, or on it alone where it stands nowhere. */
  followClimate(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void>;
  /** Takes the stage rules off a device: it stands where no climate was written. */
  dropStage(deviceId: string): Promise<void>;
  /** Takes the stage rules off every device standing where this one stands: the climate written there was taken back. */
  leaveClimate(deviceId: string): Promise<void>;
  /** The climate the stage rules of the place this device stands in follow, the one most of its devices carry; null for none. */
  climateHere(deviceId: string): Promise<{ stage: GrowthStage; preset: string | null } | null>;
  /** The stage and preset the stage rules of these devices were written for, the one most of them carry; null where none has any. */
  stageOf(deviceIds: readonly string[]): Promise<{ stage: GrowthStage; preset: string | null } | null>;
}

export const STAGE_ALARMS = Symbol('StageAlarms');
