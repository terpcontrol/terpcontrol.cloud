import type { Task } from '@fg2/shared-types/v1';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { AlarmEvent } from '@modules/alarm/alarm.types';
import { bandOf, watchedName } from '@modules/alarm/alarm.watch';
import { Announcement } from './notification.types';

/**
 * What a notification says, in one place for every channel.
 *
 * A push notification, a mail, a chat message and a webhook payload all carry
 * the same two lines, because they are the same message: somebody reading a
 * tent's alarm in a chat and the same person reading it in their inbox an hour
 * later should not have to work out that it was one event.
 *
 * These are sentences rather than message keys. The diary's own lines carry
 * `message { key, params }` and the app translates them, but a notification
 * leaves the app - a mail and a chat message are read where no translator is -
 * so it is written out here, as the alarm mails have always been.
 */

export const alertAnnouncement = (event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null): Announcement => {
  const name = rule?.name ?? kindReads[alert.kind];
  const over = event === 'resolved';

  return {
    category: 'alerts',
    subject: { type: 'alert', id: alert.id },
    // That something is over is worth knowing and never worth waking up for,
    // which is the same rule the diary line follows.
    severity: over ? 'info' : alert.severity,
    title: over ? `${name} is over` : name,
    body: [over ? 'The alarm has cleared.' : 'An alarm has been raised.', watched(alert, rule), value(alert, rule, over)].filter(Boolean).join(' '),
  };
};

/** A task by what a message needs of it, which is what it is called and when it was wanted. */
export const taskAnnouncement = (task: Pick<Task, 'id' | 'label' | 'dueAt'>): Announcement => ({
  category: 'tasks',
  subject: { type: 'task', id: task.id },
  severity: 'info',
  title: task.label,
  body: `This was due ${task.dueAt}.`,
});

/** What an alert with no rule behind it is called: the health loop's own two. */
const kindReads: Record<StoredAlert['kind'], string> = {
  threshold: 'Alarm',
  offline: 'Device offline',
  camera_stale: 'Camera has stopped sending pictures',
};

const watched = (alert: StoredAlert, rule: StoredAlarmRule | null): string =>
  rule ? `Watching ${watchedName(rule.watch)} on device ${alert.deviceId}.` : `Device ${alert.deviceId ?? alert.cameraId}.`;

/**
 * The reading, and the worst of it once the episode is over. A rule with no
 * band - an output watched for running at all, and the health metrics - has no
 * threshold to state, exactly as the alarm on a fridge compressor never had.
 */
const value = (alert: StoredAlert, rule: StoredAlarmRule | null, over: boolean): string => {
  const band = rule ? bandOf(rule.watch) : null;
  const bounds = band && (band.upper !== null || band.lower !== null) ? band : null;
  const thresholds = bounds
    ? ` (${[bounds.upper !== null ? `above ${bounds.upper}` : '', bounds.lower !== null ? `below ${bounds.lower}` : ''].filter(Boolean).join(' or ')})`
    : '';

  const reading = over ? alert.extremeValue : alert.value;
  return reading === null ? '' : `Value ${reading}${thresholds}.`;
};
