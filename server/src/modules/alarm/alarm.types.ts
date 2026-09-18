import { Metric } from '@fg2/shared-types/v1';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { StoredDevice, StoredDeviceState } from '@database/schemas/v1/devices.schema';

/**
 * What the alarms are handed and what they ask of the parts beside them.
 *
 * Both ports are optional. An alert is recorded, written to the diary and
 * delivered by the rule's own e-mail or webhook whether or not either of them is
 * wired in, so a part that is not there yet costs the alarm nothing.
 */

/** One device's readings of one instant, in the names the contract gives them. */
export interface MetricSample {
  deviceId: string;
  measuredAt: Date;
  /** A metric the device did not report is absent; no rule on it is evaluated. */
  values: Partial<Record<Metric, number>>;
}

/** The little of a device an alarm is about: where it is, and whether it is being worked on. */
export type AlarmDevice = Pick<StoredDevice, 'id' | 'spaceId' | 'ownerId'> & {
  state: Pick<StoredDeviceState, 'lastSeenAt' | 'maintenanceUntil'>;
};

/** What every read of a device for the alarms selects, so the shape and the projection cannot drift. */
export const ALARM_DEVICE_FIELDS = { id: 1, spaceId: 1, ownerId: 1, 'state.lastSeenAt': 1, 'state.maintenanceUntil': 1 } as const;

/** Whether the alert was raised or is over. A repeat says `triggered` again. */
export type AlarmEvent = 'triggered' | 'resolved';

/** A message by the owner's own notification settings. Provided by the notifications part. */
export const ALARM_ROUTING = 'alarm:routing';

export interface AlarmRouting {
  /** `rule` is null for what the health loop raised without one. */
  deliver(event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null): Promise<void>;
}

/** The grow standing in a space, so an alarm shows up in its diary. Provided by the grows part. */
export const GROW_IN_SPACE = 'alarm:grow-in-space';

export interface GrowInSpace {
  growIdIn(spaceId: string): Promise<string | null>;
}
