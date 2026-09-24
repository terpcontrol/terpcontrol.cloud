import { ConfigType } from '@nestjs/config';
import type { NotificationChannel, PlanStep, Severity } from '@fg2/shared-types/v1';
import { appConfig, notificationsConfig, authConfig } from '../../src/config/configuration';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { EmailChannel } from '@modules/v1/notification/channels/email.channel';
import { PushChannel } from '@modules/v1/notification/channels/push.channel';
import { TelegramChannel } from '@modules/v1/notification/channels/telegram.channel';
import { WebhookChannel } from '@modules/v1/notification/channels/webhook.channel';
import { NotificationLogService } from '@modules/v1/notification/notification-log.service';
import { planAnnouncement, weeklyTimelapseAnnouncement } from '@modules/v1/notification/notification-messages';
import { NotificationService, inQuietHours } from '@modules/v1/notification/notification.service';
import { Announcement, NotificationChannelSender } from '@modules/v1/notification/notification.types';
import { PlanAnnouncerService } from '@modules/v1/notification/plan-announcer.service';
import { RecipientsService } from '@modules/v1/notification/recipients.service';
import { TaskAnnouncerService } from '@modules/v1/notification/task-announcer.service';
import { TelegramBotService } from '@modules/v1/notification/telegram-bot.service';
import { LINK_VALID_MS, mintTelegramLink, readTelegramLink } from '@modules/v1/notification/telegram-link';
import { WeeklyRecapService } from '@modules/v1/notification/weekly-recap.service';
import { MailService } from '@modules/mail/mail.service';
import { V1TestDatabase, startV1TestDatabase } from './support/v1-database';

/**
 * The send decision: one message, one person, and whether anything is said at
 * all.
 *
 * Everything worth asserting here is a refusal. An account is told nothing
 * until it asks to be - the routing grid starts empty and stays empty through
 * the migration - a channel says nothing until both this install and this
 * person have configured it, a mute is absolute, and quiet hours hold back
 * everything but a critical alarm. Getting any of those wrong is a server that
 * writes to somebody who never gave it an address.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';
const SPACE = 'space-1';
const DEVICE = 'device-1';

let db: V1TestDatabase;
let notifications: NotificationService;
let log: NotificationLogService;
let mailed: { to: string; subject: string }[];
let sent: { channel: NotificationChannel; userId: string }[];
let said: Announcement[];

const alarm = (severity: Severity = 'warning'): Announcement => ({
  category: 'alerts',
  subject: { type: 'alert', id: 'alert-1' },
  severity,
  title: 'Too warm',
  body: 'The tent is at 34.',
});

/** A channel that is always configured, so that what the decision does is visible on its own. */
const spyChannel = (name: NotificationChannel): NotificationChannelSender => ({
  name,
  send: async (to: StoredUser, message: Announcement) => {
    sent.push({ channel: name, userId: to.id });
    said.push(message);
    return { externalMessageId: `${name}-1` };
  },
});

const account = (id: string, over: Record<string, unknown> = {}) =>
  db.users.create({ id, email: `${id}@test.invalid`, handle: id, passwordHash: 'x', isActive: true, ...over });

const routed = (channels: NotificationChannel[]) => ({
  notifications: { routing: { alerts: channels, warnings: channels, tasks: channels, plan: channels, weekly_timelapse: channels } },
});

/** Everything an install can configure about the two outward-facing channels, all of it off. */
const nothingConfigured = {
  pushPublicKey: null,
  pushPrivateKey: null,
  pushContact: null,
  telegramBotToken: null,
  telegramBotUsername: null,
  telegramWebhookSecret: null,
} as ConfigType<typeof notificationsConfig>;

const SECRET = 'a-secret-key-for-the-spec';

const build = (channels: NotificationChannelSender[]): NotificationService => {
  log = new NotificationLogService(db.notificationLog);
  const recipients = new RecipientsService(db.spaces, db.memberships, db.devices, db.cameras, db.grows);

  return new NotificationService(db.users, channels, log, recipients);
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  mailed = [];
  sent = [];
  said = [];
  notifications = build([spyChannel('push'), spyChannel('telegram'), spyChannel('email'), spyChannel('webhook')]);
});

describe('the routing grid', () => {
  it('says nothing to an account that has asked for nothing, which is what every account starts as', async () => {
    await account(OWNER);

    expect(await notifications.tell(OWNER, alarm())).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('sends on the channels the category names and on no others', async () => {
    await account(OWNER, routed(['email', 'push']));

    expect((await notifications.tell(OWNER, alarm())).sort()).toEqual(['email', 'push']);
    expect(sent.map(one => one.channel).sort()).toEqual(['email', 'push']);
  });

  it('records what was said, so that a reply can be matched back to it', async () => {
    await account(OWNER, routed(['telegram']));
    await notifications.tell(OWNER, alarm());

    const recorded = await db.notificationLog.find({}).lean();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      userId: OWNER,
      channel: 'telegram',
      category: 'alerts',
      subject: { type: 'alert', id: 'alert-1' },
      externalMessageId: 'telegram-1',
    });
  });

  it('tells nothing to an account on its way out', async () => {
    await account(OWNER, { ...routed(['email']), deletionStartedAt: new Date() });

    expect(await notifications.tell(OWNER, alarm())).toEqual([]);
  });
});

describe('what keeps a person undisturbed', () => {
  it('mutes everything, critical alarms included, for the person who asked', async () => {
    await account(OWNER, { ...routed(['email']), notifications: { ...routed(['email']).notifications, mutedUntil: new Date(Date.now() + 60_000) } });

    expect(await notifications.tell(OWNER, alarm('critical'))).toEqual([]);
  });

  it('holds a warning back during quiet hours and lets a critical alarm through', async () => {
    // A window that covers the whole day, so the case does not depend on when
    // it is run.
    const allDay = { fromMinute: 0, toMinute: 1439 };
    await account(OWNER, { notifications: { routing: { alerts: ['email'] }, quietHours: allDay } });

    expect(await notifications.tell(OWNER, alarm('warning'))).toEqual([]);
    expect(await notifications.tell(OWNER, alarm('critical'))).toEqual(['email']);
  });

  it('reads a window in the person´s own time zone, not the server´s', () => {
    const at = new Date('2026-09-19T23:30:00.000Z');

    // Half past eleven at night in London, half past seven in the morning in Tokyo.
    expect(inQuietHours({ fromMinute: 22 * 60, toMinute: 7 * 60 }, 'Europe/London', at)).toBe(true);
    expect(inQuietHours({ fromMinute: 22 * 60, toMinute: 7 * 60 }, 'Asia/Tokyo', at)).toBe(false);
  });

  it('says a thing once, however often the loop comes round', async () => {
    await account(OWNER, routed(['email']));
    const task: Announcement = { category: 'tasks', subject: { type: 'task', id: 'task-1' }, severity: 'info', title: 'Water', body: 'Due.' };

    expect(await notifications.tellOnce(OWNER, task)).toEqual(['email']);
    expect(await notifications.tellOnce(OWNER, task)).toEqual([]);
    expect(sent).toHaveLength(1);
  });
});

/**
 * The rule the record states outright: every channel is off until it is
 * configured. These are the real senders rather than the spies, because what is
 * being asserted is exactly what they do when nobody has set them up.
 */
describe('a channel nobody has configured', () => {
  beforeEach(() => {
    const mail = {
      send: async (message: { to: string; subject: string }) => void mailed.push(message),
    } as unknown as MailService;
    const bot = new TelegramBotService(nothingConfigured, { secretKey: SECRET } as ConfigType<typeof authConfig>);

    notifications = build([
      new PushChannel(db.pushSubscriptions, nothingConfigured),
      new TelegramChannel(bot),
      new EmailChannel(mail),
      new WebhookChannel(),
    ]);
  });

  it('sends nothing, even where the person asked for every one of them', async () => {
    await account(OWNER, routed(['email', 'push', 'telegram', 'webhook']));

    expect(await notifications.tell(OWNER, alarm())).toEqual([]);
    expect(mailed).toEqual([]);
    expect(await db.notificationLog.countDocuments({})).toBe(0);
  });

  it('mails the address the person named, which is never their sign-in address', async () => {
    await account(OWNER, {
      ...routed(['email']),
      notifications: { routing: { alerts: ['email'] }, channels: { email: 'alarms@test.invalid' } },
    });

    await notifications.tell(OWNER, alarm());

    expect(mailed).toEqual([expect.objectContaining({ to: 'alarms@test.invalid', subject: '[TERP CONTROL] Too warm' })]);
  });

  it('pushes to nobody while this install has no key pair, however many browsers subscribed', async () => {
    await account(OWNER, routed(['push']));
    await db.pushSubscriptions.create({
      id: 'sub-1',
      userId: OWNER,
      endpoint: 'https://push.test.invalid/1',
      keys: { p256dh: 'p', auth: 'a' },
    });

    expect(await notifications.tell(OWNER, alarm())).toEqual([]);
  });
});

describe('who is told about an alarm', () => {
  const alert = {
    id: 'alert-1',
    createdAt: new Date(),
    ruleId: 'rule-1',
    deviceId: DEVICE,
    cameraId: null,
    spaceId: SPACE,
    kind: 'threshold',
    severity: 'warning',
    startedAt: new Date(),
    resolvedAt: null,
    value: 34,
    extremeValue: 34,
  } as StoredAlert;

  beforeEach(async () => {
    await Promise.all([account(OWNER, routed(['email'])), account(MEMBER, routed(['email'])), account(STRANGER, routed(['email']))]);
    await db.spaces.create({ id: SPACE, ownerId: OWNER, kind: 'tent', name: 'Tent' });
    await db.memberships.create({ id: 'membership-1', spaceId: SPACE, userId: MEMBER, role: 'can_log', invitedBy: OWNER, inviteId: null });
  });

  it('tells the owner and everybody the tent is shared with, and nobody else', async () => {
    await notifications.deliver('triggered', alert, null);

    expect(sent.map(one => one.userId).sort()).toEqual([MEMBER, OWNER].sort());
  });

  it('tells each of them by their own settings', async () => {
    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.mutedUntil': new Date(Date.now() + 60_000) } });

    await notifications.deliver('triggered', alert, null);

    expect(sent.map(one => one.userId)).toEqual([OWNER]);
  });

  it('sends a warning on the warnings row of the grid and not on the alerts row', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { 'notifications.routing': { alerts: ['push'], warnings: ['email'] } } });
    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.routing': { alerts: ['push'], warnings: [] } } });

    await notifications.deliver('triggered', alert, null);

    expect(sent).toEqual([{ channel: 'email', userId: OWNER }]);
    expect(await db.notificationLog.findOne({ userId: OWNER }).lean()).toMatchObject({ category: 'warnings' });
  });

  it('sends a critical alarm on the alerts row, and its all-clear on the same row', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { 'notifications.routing': { alerts: ['push'], warnings: ['email'] } } });
    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.routing': { alerts: [], warnings: ['email'] } } });
    const critical = { ...alert, id: 'alert-critical', severity: 'critical' } as StoredAlert;

    await notifications.deliver('triggered', critical, null);
    await notifications.deliver('resolved', { ...critical, resolvedAt: new Date() }, null);

    expect(sent).toEqual([
      { channel: 'push', userId: OWNER },
      { channel: 'push', userId: OWNER },
    ]);
  });

  it('announces an info alarm nowhere, however the grid is filled in', async () => {
    await notifications.deliver('triggered', { ...alert, severity: 'info' } as StoredAlert, null);

    expect(sent).toEqual([]);
    expect(await db.notificationLog.countDocuments({})).toBe(0);
  });
});

/**
 * The loop that notices a rhythm has come round. It is the one producer of
 * notifications that lives beside the decision, because nothing else would see
 * that a task became due in the night.
 */
describe('announcing a task that is due', () => {
  let announcer: TaskAnnouncerService;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const rhythm = (over: Record<string, unknown> = {}) =>
    db.reminders.create({
      id: 'reminder-1',
      subject: { type: 'space', id: SPACE },
      kind: 'water',
      label: 'Water the tent',
      everyDays: 3,
      createdBy: OWNER,
      createdAt: new Date(Date.now() - 4 * DAY_MS),
      ...over,
    });

  beforeEach(async () => {
    await Promise.all([account(OWNER, routed(['email'])), account(MEMBER, routed(['email']))]);
    await db.spaces.create({ id: SPACE, ownerId: OWNER, kind: 'tent', name: 'Tent' });
    await db.memberships.create({ id: 'membership-1', spaceId: SPACE, userId: MEMBER, role: 'can_log', invitedBy: OWNER, inviteId: null });

    announcer = new TaskAnnouncerService(
      db.reminders,
      db.entries,
      db.spaces,
      db.grows,
      notifications,
      new RecipientsService(db.spaces, db.memberships, db.devices, db.cameras, db.grows),
    );
  });

  it('tells everybody who keeps the tent, once, however often it runs', async () => {
    await rhythm();

    await announcer.run();
    await announcer.run();

    expect(sent.map(one => one.userId).sort()).toEqual([MEMBER, OWNER].sort());
  });

  it('tells the person it was given to and nobody else', async () => {
    await rhythm({ assigneeId: MEMBER });

    await announcer.run();

    expect(sent.map(one => one.userId)).toEqual([MEMBER]);
  });

  it('says nothing about work that is not due yet', async () => {
    await rhythm({ everyDays: 30 });

    await announcer.run();

    expect(sent).toEqual([]);
  });

  it('says nothing about a tent that has been archived', async () => {
    await rhythm();
    await db.spaces.updateOne({ id: SPACE }, { $set: { archivedAt: new Date() } });

    await announcer.run();

    expect(sent).toEqual([]);
  });
});

/**
 * A recipe standing still until somebody answers it.
 *
 * The plan has a delivery of its own, written on the recipe, and this is the
 * other one: the people who keep the tent, each on the channels they asked for.
 * What is asserted here is who hears it and how often - the plan's own mail is
 * the plan module's and is asserted where the engine is driven.
 */
describe('asking somebody to confirm a plan step', () => {
  let announcer: PlanAnnouncerService;

  const step: PlanStep = {
    id: 'step-1',
    name: 'Defoliate',
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'days' },
    settings: {},
    waitForConfirmation: true,
    confirmationMessage: 'Take the big fan leaves off.',
  };

  const waiting = (over: Partial<StoredPlan['state']> = {}): StoredPlan =>
    ({
      id: 'plan-1',
      createdAt: new Date(),
      deviceId: DEVICE,
      templateId: null,
      name: 'Two weeks of veg',
      steps: [step],
      loop: true,
      notify: { mode: 'off', email: null, writeEntries: true },
      state: {
        status: 'running',
        activeStepIndex: 0,
        stepStartedAt: new Date('2026-09-15T08:00:00.000Z'),
        pausedElapsedMs: 0,
        pauseReason: null,
        lastAppliedAt: null,
        confirmationNotifiedAt: null,
        confirmationAskedAt: null,
        confirmationAskTriedAt: null,
        ...over,
      },
    }) as StoredPlan;

  beforeEach(async () => {
    await Promise.all([account(OWNER, routed(['email'])), account(MEMBER, routed(['email'])), account(STRANGER, routed(['email']))]);
    await db.spaces.create({ id: SPACE, ownerId: OWNER, kind: 'tent', name: 'The big tent' });
    await db.memberships.create({ id: 'membership-1', spaceId: SPACE, userId: MEMBER, role: 'can_log', invitedBy: OWNER, inviteId: null });
    await db.devices.create({ id: DEVICE, ownerId: OWNER, spaceId: SPACE, type: 'controller' });

    announcer = new PlanAnnouncerService(
      db.devices,
      db.spaces,
      notifications,
      new RecipientsService(db.spaces, db.memberships, db.devices, db.cameras, db.grows),
    );
  });

  it('tells everybody who keeps the tent, and nobody else', async () => {
    await announcer.askedToConfirm(waiting(), step);

    expect(sent.map(one => one.userId).sort()).toEqual([MEMBER, OWNER].sort());
    expect(said[0]).toMatchObject({ category: 'plan', severity: 'info' });
    expect(said[0].title).toContain('The big tent');
    expect(said[0].body).toContain('Take the big fan leaves off.');
  });

  it('asks once, however often the step is read again while it waits', async () => {
    const plan = waiting();

    await announcer.askedToConfirm(plan, step);
    await announcer.askedToConfirm(plan, step);
    await announcer.askedToConfirm(plan, step);

    expect(sent).toHaveLength(2);
  });

  it('asks again when the plan comes round to the same step a second time', async () => {
    await announcer.askedToConfirm(waiting(), step);
    await announcer.askedToConfirm(waiting({ stepStartedAt: new Date('2026-09-29T08:00:00.000Z') }), step);

    expect(sent).toHaveLength(4);
  });

  it('is settled once everybody has heard it, and once for somebody who wanted to hear nothing', async () => {
    expect(await announcer.askedToConfirm(waiting(), step)).toBe(true);

    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.routing.plan': [] } });
    await db.notificationLog.deleteMany({});

    expect(await announcer.askedToConfirm(waiting(), step)).toBe(true);
  });

  it('stays outstanding while somebody´s night holds it back, and reaches them once the night is over', async () => {
    const allDay = { fromMinute: 0, toMinute: 1439 };
    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.quietHours': allDay } });

    expect(await announcer.askedToConfirm(waiting(), step)).toBe(false);
    expect(sent.map(one => one.userId)).toEqual([OWNER]);

    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.quietHours': null } });

    expect(await announcer.askedToConfirm(waiting(), step)).toBe(true);
    expect(sent.map(one => one.userId).sort()).toEqual([MEMBER, OWNER].sort());
  });
});

/**
 * The week a camera has just finished.
 *
 * Only that one week is ever read. The film of the open week is rebuilt every
 * few hours under a new id, so a recap of it would arrive again with every
 * rebuild; the weeks before it are history, and a fresh install must not
 * announce a month of it on its first pass.
 */
describe('the weekly recap', () => {
  const CAMERA = 'camera-1';
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const openPeriodEnd = Math.ceil(Date.now() / WEEK_MS) * WEEK_MS;
  const lastWeek = new Date(openPeriodEnd - 2 * WEEK_MS);

  let recaps: WeeklyRecapService;

  const film = (capturedAt: Date, over: Partial<MediaDocument> = {}) =>
    db.media.create({
      id: `film-${capturedAt.getTime()}`,
      kind: 'timelapse',
      mime: 'video/mp4',
      bytes: 1024,
      cameraId: CAMERA,
      window: 'week',
      capturedAt,
      endsAt: new Date(capturedAt.getTime() + 6 * 24 * 60 * 60 * 1000),
      ...over,
    });

  const still = (capturedAt: Date) =>
    db.media.create({ id: `still-${capturedAt.getTime()}`, kind: 'still', mime: 'image/jpeg', bytes: 10, cameraId: CAMERA, capturedAt });

  beforeEach(async () => {
    await Promise.all([account(OWNER, routed(['email'])), account(MEMBER, routed(['email']))]);
    await db.spaces.create({ id: SPACE, ownerId: OWNER, kind: 'tent', name: 'The big tent' });
    await db.memberships.create({ id: 'membership-1', spaceId: SPACE, userId: MEMBER, role: 'can_log', invitedBy: OWNER, inviteId: null });
    await db.cameras.create({ id: CAMERA, ownerId: OWNER, spaceId: SPACE, kind: 'rtsp', name: 'Above the canopy' });

    recaps = new WeeklyRecapService(
      db.cameras,
      db.media,
      { appUrlExternal: 'https://app.test.invalid' } as ConfigType<typeof appConfig>,
      notifications,
      new RecipientsService(db.spaces, db.memberships, db.devices, db.cameras, db.grows),
    );
  });

  it('offers the week just gone to everybody who keeps the camera, once', async () => {
    await film(lastWeek);

    await recaps.run();
    await recaps.run();

    expect(sent.map(one => one.userId).sort()).toEqual([MEMBER, OWNER].sort());
    expect(said[0]).toMatchObject({ category: 'weekly_timelapse', subject: { type: 'media', id: `film-${lastWeek.getTime()}` } });
    expect(said[0].title).toContain('Above the canopy');
    expect(said[0].body).toContain(`https://app.test.invalid/cameras/${CAMERA}?film=film-${lastWeek.getTime()}`);
  });

  it('says nothing about a week that is older than the one just gone', async () => {
    await film(new Date(openPeriodEnd - 4 * WEEK_MS));

    await recaps.run();

    expect(sent).toEqual([]);
  });

  it('waits while the builder still has the film to finish', async () => {
    await film(lastWeek);
    await still(new Date(lastWeek.getTime() + 6.5 * 24 * 60 * 60 * 1000));

    await recaps.run();

    expect(sent).toEqual([]);
  });

  it('tells nobody who has asked for nothing', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { 'notifications.routing': {} } });
    await db.users.updateOne({ id: MEMBER }, { $set: { 'notifications.routing': { alerts: ['email'] } } });
    await film(lastWeek);

    await recaps.run();

    expect(sent).toEqual([]);
  });

  it('sends the recap without a link where the install has not said where its app is served', async () => {
    recaps = new WeeklyRecapService(
      db.cameras,
      db.media,
      { appUrlExternal: null } as ConfigType<typeof appConfig>,
      notifications,
      new RecipientsService(db.spaces, db.memberships, db.devices, db.cameras, db.grows),
    );
    await film(lastWeek);

    await recaps.run();

    expect(sent).toHaveLength(2);
    expect(said[0].body).not.toContain('http');
  });
});

/**
 * The words themselves. They leave the app - a mail and a chat message are read
 * where no translator is - so what they say is worth asserting rather than only
 * that something was said.
 */
describe('what the two new messages say', () => {
  const step: PlanStep = {
    id: 'step-1',
    name: 'Defoliate',
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'days' },
    settings: {},
    waitForConfirmation: true,
    confirmationMessage: '  Take the big fan leaves off.  ',
  };

  const plan = {
    id: 'plan-1',
    name: 'Two weeks of veg',
    state: { activeStepIndex: 1, stepStartedAt: new Date('2026-09-15T08:00:00.000Z') },
  } as StoredPlan;

  /** The camera that shot the week, which is also the page a tap on the push has to land on. */
  const CAMERA_ABOVE = { id: 'camera-1', name: 'Above the canopy' };

  it('names the tent, the step and what was asked', () => {
    const message = planAnnouncement(plan, step, 'The big tent');

    expect(message).toMatchObject({ category: 'plan', severity: 'info', subject: { type: 'plan' } });
    expect(message.title).toBe('The big tent: step #2 Defoliate is waiting for you');
    expect(message.body).toBe('The plan Two weeks of veg stands still until this step is confirmed. Take the big fan leaves off.');
  });

  it('keeps one ask apart from the next time round the same step', () => {
    const again = { ...plan, state: { ...plan.state, stepStartedAt: new Date('2026-09-29T08:00:00.000Z') } } as StoredPlan;

    expect(planAnnouncement(plan, step, 'The big tent').subject.id).toBe(planAnnouncement(plan, step, 'Renamed since').subject.id);
    expect(planAnnouncement(again, step, 'The big tent').subject.id).not.toBe(planAnnouncement(plan, step, 'The big tent').subject.id);
  });

  it('says only that a step is waiting where it asks nothing in particular', () => {
    const message = planAnnouncement(plan, { ...step, confirmationMessage: null }, 'The big tent');

    expect(message.body).toBe('The plan Two weeks of veg stands still until this step is confirmed.');
  });

  it('names the camera, the week and where the film is watched', () => {
    const week = { id: 'media-1', capturedAt: new Date('2026-09-10T00:00:00.000Z'), endsAt: new Date('2026-09-16T22:00:00.000Z') };
    const message = weeklyTimelapseAnnouncement(week, CAMERA_ABOVE, 'https://app.test.invalid/cameras/camera-1?film=media-1');

    expect(message).toMatchObject({
      category: 'weekly_timelapse',
      severity: 'info',
      subject: { type: 'media', id: 'media-1' },
      // The film's own id addresses no screen, so the push carries the camera too.
      cameraId: 'camera-1',
    });
    expect(message.title).toBe('Above the canopy: the week to 16 September 2026');
    expect(message.body).toBe('A week of pictures, rolled up into one film. Watch it at https://app.test.invalid/cameras/camera-1?film=media-1.');
  });

  it('says its piece without a link rather than with a broken one', () => {
    const week = { id: 'media-1', capturedAt: new Date('2026-09-10T00:00:00.000Z'), endsAt: null };

    expect(weeklyTimelapseAnnouncement(week, CAMERA_ABOVE, null).body).toBe('A week of pictures, rolled up into one film.');
    expect(weeklyTimelapseAnnouncement(week, CAMERA_ABOVE, null).title).toBe('Above the canopy: the week to 10 September 2026');
  });
});

/**
 * The deep link that binds a chat. Telegram allows sixty-four characters of
 * payload and nothing else, so the token is the smallest thing that can carry
 * an account and an expiry and still be checked.
 */
describe('the Telegram link', () => {
  const userId = '3f9a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

  it('names the account back, and fits in a deep link', () => {
    const token = mintTelegramLink(SECRET, userId, new Date(Date.now() + LINK_VALID_MS))!;

    expect(token.length).toBeLessThanOrEqual(64);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readTelegramLink(SECRET, token)).toBe(userId);
  });

  it('carries an id that is not a uuid as well', () => {
    const legacy = 'an-account-from-before';
    const token = mintTelegramLink(SECRET, legacy, new Date(Date.now() + LINK_VALID_MS))!;

    expect(readTelegramLink(SECRET, token)).toBe(legacy);
  });

  it('is worth nothing once it is over', () => {
    const token = mintTelegramLink(SECRET, userId, new Date(Date.now() - 60_000))!;

    expect(readTelegramLink(SECRET, token)).toBeNull();
  });

  it('is worth nothing when it has been changed, or signed with something else', () => {
    const token = mintTelegramLink(SECRET, userId, new Date(Date.now() + LINK_VALID_MS))!;
    // Never the character it already ends in, which the signature does one
    // minute in sixty-four.
    const changed = `${token.slice(0, -1)}${token.endsWith('x') ? 'y' : 'x'}`;

    expect(readTelegramLink(SECRET, changed)).toBeNull();
    expect(readTelegramLink('another-secret', token)).toBeNull();
    expect(readTelegramLink(SECRET, 'nonsense')).toBeNull();
  });
});
