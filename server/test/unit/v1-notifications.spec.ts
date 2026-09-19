import { ConfigType } from '@nestjs/config';
import type { NotificationChannel, Severity } from '@fg2/shared-types/v1';
import { notificationsConfig, authConfig } from '../../src/config/configuration';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { EmailChannel } from '@modules/v1/notification/channels/email.channel';
import { PushChannel } from '@modules/v1/notification/channels/push.channel';
import { TelegramChannel } from '@modules/v1/notification/channels/telegram.channel';
import { WebhookChannel } from '@modules/v1/notification/channels/webhook.channel';
import { NotificationLogService } from '@modules/v1/notification/notification-log.service';
import { NotificationService, inQuietHours } from '@modules/v1/notification/notification.service';
import { Announcement, NotificationChannelSender } from '@modules/v1/notification/notification.types';
import { RecipientsService } from '@modules/v1/notification/recipients.service';
import { TaskAnnouncerService } from '@modules/v1/notification/task-announcer.service';
import { TelegramBotService } from '@modules/v1/notification/telegram-bot.service';
import { LINK_VALID_MS, mintTelegramLink, readTelegramLink } from '@modules/v1/notification/telegram-link';
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
  send: async (to: StoredUser) => {
    sent.push({ channel: name, userId: to.id });
    return { externalMessageId: `${name}-1` };
  },
});

const account = (id: string, over: Record<string, unknown> = {}) =>
  db.users.create({ id, email: `${id}@test.invalid`, handle: id, passwordHash: 'x', isActive: true, ...over });

const routed = (channels: NotificationChannel[]) => ({ notifications: { routing: { alerts: channels, tasks: channels } } });

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

    expect(readTelegramLink(SECRET, `${token.slice(0, -1)}x`)).toBeNull();
    expect(readTelegramLink('another-secret', token)).toBeNull();
    expect(readTelegramLink(SECRET, 'nonsense')).toBeNull();
  });
});
