import { DateTime } from 'luxon';
import type { PlanStep, Task } from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
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

/**
 * Null for an alarm that is not announced at all. The row is the contract's
 * `alertCategory`, read off the alert rather than the rule so that a resolution
 * lands in the row the alarm was announced in however the rule has been edited
 * since.
 */
export const alertAnnouncement = (event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null): Announcement | null => {
  const category = alertCategory(alert.severity);
  if (!category) return null;

  const name = rule?.name ?? kindReads[alert.kind];
  const over = event === 'resolved';

  return {
    category,
    subject: { type: 'alert', id: alert.id },
    // That something is over is worth knowing and never worth waking up for,
    // which is the same rule the diary line follows: the all-clear of a
    // critical alarm goes out on the same row of the grid, and quiet hours
    // hold it back as they hold back any other news.
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

/**
 * A plan standing still until somebody answers it. `tent` is what the place the
 * device runs in is called, because that is how a person knows which of their
 * tents is waiting; the step's own message is the whole of what they were asked,
 * and a step that asks nothing in particular says only that it is waiting.
 */
export const planAnnouncement = (plan: StoredPlan, step: PlanStep, tent: string): Announcement => ({
  category: 'plan',
  subject: { type: 'plan', id: askOf(plan) },
  severity: 'info',
  title: `${tent}: step #${plan.state.activeStepIndex + 1} ${step.name} is waiting for you`,
  body: [`The plan ${plan.name} stands still until this step is confirmed.`, step.confirmationMessage?.trim()].filter(Boolean).join(' '),
});

/**
 * Which ask this is, which is what the log remembers so that a step waiting for
 * a week is not announced every twenty seconds.
 *
 * The plan alone would be too coarse - a plan asks about each of its steps in
 * turn, and the second question would be swallowed by the answer to the first -
 * and the step index alone too coarse again, because a looping plan comes back
 * to the same step and has to be able to ask about it a second time. What makes
 * one ask is therefore the step *and* the moment that step started running,
 * which is set once when the plan reaches it and is the same instant for every
 * reader of the plan.
 */
const askOf = (plan: StoredPlan): string => `${plan.id}:${plan.state.activeStepIndex}:${plan.state.stepStartedAt?.getTime() ?? 0}`;

/**
 * The week, as a film. The link is the app's own address for it and is absent
 * where this install has not been told where its app is served; the message
 * then says what there is to watch and leaves it to be found, which is better
 * than sending anybody to an address nobody has stated.
 *
 * The day named is the last frame's, read in UTC, which is the clock the rolling
 * films are cut by.
 */
export const weeklyTimelapseAnnouncement = (
  film: Pick<MediaDocument, 'id' | 'capturedAt' | 'endsAt'>,
  camera: Pick<CameraDocument, 'id' | 'name'>,
  link: string | null,
  zone: string | null = null,
): Announcement => ({
  category: 'weekly_timelapse',
  subject: { type: 'media', id: film.id },
  // The film is watched on the page of the camera that shot it, which is why
  // the camera is named beside the subject: a tap on the push has nowhere else
  // to go from a film's id alone.
  cameraId: camera.id,
  severity: 'info',
  title: `${camera.name}: the week to ${dayOf(film.endsAt ?? film.capturedAt, zone)}`,
  body: ['A week of pictures, rolled up into one film.', link ? `Watch it at ${link}.` : null].filter(Boolean).join(' '),
});

/** The day in the owner's zone, where the week was cut; UTC where the account names none. */
const dayOf = (at: Date, zone: string | null): string => {
  const local = DateTime.fromJSDate(at, { zone: zone || 'utc' });
  return (local.isValid ? local : DateTime.fromJSDate(at, { zone: 'utc' })).setLocale('en').toFormat('d LLLL yyyy');
};

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
