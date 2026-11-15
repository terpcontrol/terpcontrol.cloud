import type { GrowthStage } from '@fg2/shared-types/v1';

/**
 * The stage-bound alarm thresholds, re-read whenever a grow enters a phase.
 *
 * The rules themselves belong to the alarm engine, which owns `alarmRules` and
 * the `presetId` a stage writes its rules under; the phase writer only says that
 * the stage changed.
 *
 * Optional, like every port between two slices here: until something is bound to
 * this token a phase is still written and a grow still moves on, and the rules
 * of the device simply stay as they were.
 */
export interface StageAlarms {
  /** Writes, updates or removes the rules this stage and preset imply for the device. */
  applyStage(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void>;
  /** The stage and preset the stage rules of these devices were written for, the one most of them carry; null where none has any. */
  stageOf(deviceIds: readonly string[]): Promise<{ stage: GrowthStage; preset: string | null } | null>;
}

export const STAGE_ALARMS = Symbol('StageAlarms');
