import { AccessService } from '@common/v1/access.service';
import { ProblemException } from '@common/v1/problem';
import { AccountDeletionService } from '@modules/v1/account-deletion/account-deletion.service';
import { AccountsService } from '@modules/v1/account/accounts.service';
import { PasswordResetService } from '@modules/v1/account/password-reset.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { SessionsService } from '@modules/v1/sessions/sessions.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * What an account deletion leaves behind, which is the whole question: the rows
 * it takes are easy to see gone, and the rows it must not take are only visible
 * from the other account's side.
 *
 * One rule decides all of them, and the schemas already spell it out. Where the
 * reference to a person may be empty, the row belongs to somebody else and only
 * the attribution is lost, so it is emptied; where the reference is required,
 * the row is the account's own and goes. The order that rule depends on is the
 * trap this spec is mostly about: the account's own orphans are found by the
 * very fields that emptying rewrites, so they have to be collected first.
 */

const AUTH = {
  secretKey: 'unit-spec-secret',
  automationToken: 'unit-automation-token',
  requireActivation: false,
  enableSelfRegistration: false,
  selfRegistrationPassword: undefined,
  adminUsername: 'admin@test.invalid',
  adminPassword: 'Adm1n!pass',
};

const PREMIUM = { enforced: true, freeStillWidth: 0, freeRetention: false, freeStillDays: 0, freeTimelapseDays: 0, extendUrl: '', priceLabel: '' };
const NOTIFICATIONS = { pushPublicKey: null, telegramBotToken: null };
const PASSWORD = 'Passw0rd!test';

let db: V1TestDatabase;
let accounts: AccountsService;
let deletion: AccountDeletionService;

const build = (): void => {
  accounts = new AccountsService(db.users, { ...AUTH }, { ...PREMIUM }, { ...NOTIFICATIONS });

  const sessions = new SessionsService(db.sessions, accounts, { ...AUTH });
  const resets = new PasswordResetService(
    db.passwordResets,
    accounts,
    { send: async () => undefined } as never,
    {
      apiUrlExternal: 'https://api.test.invalid',
    } as never,
  );
  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);

  deletion = new AccountDeletionService(
    db.alerts,
    db.cameras,
    db.chartViews,
    db.devices,
    db.entries,
    db.follows,
    db.grows,
    db.invites,
    db.media,
    db.memberships,
    db.notificationLog,
    db.planTemplates,
    db.plants,
    db.pushSubscriptions,
    db.reminders,
    db.schemes,
    db.shareLinks,
    db.spaces,
    accounts,
    sessions,
    resets,
    devices,
    { ...AUTH },
  );
};

const signUp = (prefix: string) => accounts.signUp(`${prefix}@test.invalid`, prefix, PASSWORD);

const refusal = async (action: () => unknown): Promise<ProblemException> => {
  try {
    await action();
  } catch (error) {
    return error as ProblemException;
  }
  throw new Error('It was allowed.');
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  build();
});

describe('what the account owns', () => {
  it('goes, down to the collections nothing has a route for', async () => {
    const leaving = await signUp('leaving');

    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    await db.grows.create({ id: 'grow-1', ownerId: leaving.id, name: 'A run', type: 'photoperiod', slug: 'a-run', startedAt: new Date() });
    await db.plants.create({ id: 'plant-1', growId: 'grow-1', strain: 'Amnesia', label: '1' });
    await db.chartViews.create({ id: 'chart-1', ownerId: leaving.id, name: 'Week', definition: { intervalSeconds: 300 } });
    await db.schemes.create({ id: 'scheme-1', ownerId: leaving.id, name: 'House mix' });
    await db.planTemplates.create({ id: 'template-1', ownerId: leaving.id, name: 'Nights off', isPublic: true });
    await db.pushSubscriptions.create({
      id: 'push-1',
      userId: leaving.id,
      endpoint: 'https://push.test.invalid/1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    await db.notificationLog.create({
      id: 'log-1',
      userId: leaving.id,
      channel: 'email',
      category: 'alerts',
      subject: { type: 'alert', id: 'alert-1' },
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await deletion.deleteAccount(leaving.id);

    expect(await db.users.countDocuments({ id: leaving.id })).toBe(0);
    expect(await db.spaces.countDocuments({})).toBe(0);
    expect(await db.grows.countDocuments({})).toBe(0);
    expect(await db.plants.countDocuments({})).toBe(0);
    expect(await db.chartViews.countDocuments({})).toBe(0);
    expect(await db.schemes.countDocuments({})).toBe(0);
    expect(await db.planTemplates.countDocuments({})).toBe(0);
    expect(await db.pushSubscriptions.countDocuments({})).toBe(0);
    expect(await db.notificationLog.countDocuments({})).toBe(0);
  });

  /**
   * Neither of these would ever be collected by anything else: the sweep for
   * what nothing can reach only considers a line that names a grow, a space or a
   * device, and a line naming only its author names none of them.
   */
  it('includes the line about nothing in particular, and the picture put nowhere', async () => {
    const leaving = await signUp('leaving');

    await db.entries.create({ id: 'entry-loose', kind: 'note', occurredAt: new Date(), source: 'human', authorId: leaving.id, values: {} });
    await db.media.create({ id: 'media-loose', kind: 'photo', mime: 'image/jpeg', bytes: 1, uploadedBy: leaving.id, capturedAt: new Date() });

    await deletion.deleteAccount(leaving.id);

    expect(await db.entries.countDocuments({ id: 'entry-loose' })).toBe(0);
    expect(await db.media.countDocuments({ id: 'media-loose' })).toBe(0);
  });

  it('includes the avatar, which nothing else names once the row is gone', async () => {
    const leaving = await signUp('leaving');
    await db.media.create({ id: 'media-face', kind: 'avatar', mime: 'image/jpeg', bytes: 1, capturedAt: new Date() });
    await db.users.updateOne({ id: leaving.id }, { $set: { avatarMediaId: 'media-face' } });

    await deletion.deleteAccount(leaving.id);

    expect(await db.media.countDocuments({ id: 'media-face' })).toBe(0);
  });
});

describe('what belongs to somebody else', () => {
  it('keeps the row and loses only the name on it', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.spaces.create({ id: 'their-tent', ownerId: staying.id, kind: 'tent', name: 'Their tent' });
    await db.entries.create({
      id: 'entry-theirs',
      kind: 'note',
      occurredAt: new Date(),
      source: 'human',
      authorId: leaving.id,
      spaceId: 'their-tent',
      text: 'Watered while they were away.',
      values: {},
    });
    await db.media.create({
      id: 'media-theirs',
      kind: 'photo',
      mime: 'image/jpeg',
      bytes: 1,
      spaceId: 'their-tent',
      uploadedBy: leaving.id,
      capturedAt: new Date(),
    });
    await db.memberships.create({ id: 'member-1', spaceId: 'their-tent', userId: staying.id, role: 'can_log', invitedBy: leaving.id });
    await db.reminders.create({
      id: 'reminder-1',
      subject: { type: 'space', id: 'their-tent' },
      kind: 'water',
      label: 'Water',
      assigneeId: leaving.id,
      createdBy: staying.id,
    });
    await db.grows.create({
      id: 'their-grow',
      ownerId: staying.id,
      name: 'Theirs',
      type: 'photoperiod',
      slug: 'theirs',
      startedAt: new Date(),
      phases: [{ id: 'phase-1', stage: 'vegetative', startedAt: new Date(), source: 'human', setBy: leaving.id }],
    });

    await deletion.deleteAccount(leaving.id);

    const entry = await db.entries.findOne({ id: 'entry-theirs' }).lean();
    expect(entry?.text).toBe('Watered while they were away.');
    expect(entry?.authorId).toBeNull();

    expect((await db.media.findOne({ id: 'media-theirs' }).lean())?.uploadedBy).toBeNull();
    expect((await db.memberships.findOne({ id: 'member-1' }).lean())?.invitedBy).toBeNull();
    expect((await db.reminders.findOne({ id: 'reminder-1' }).lean())?.assigneeId).toBeNull();
    expect((await db.grows.findOne({ id: 'their-grow' }).lean())?.phases[0].setBy).toBeNull();
  });

  it('takes a line somebody else wrote on the deleted account´s own timeline', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.spaces.create({ id: 'our-tent', ownerId: leaving.id, kind: 'tent', name: 'Our tent' });
    await db.entries.create({
      id: 'entry-ours',
      kind: 'note',
      occurredAt: new Date(),
      source: 'human',
      authorId: staying.id,
      spaceId: 'our-tent',
      values: {},
    });

    await deletion.deleteAccount(leaving.id);

    expect(await db.entries.countDocuments({ id: 'entry-ours' })).toBe(0);
  });

  /**
   * A grow of somebody else's can stand in this account's tent, and ending the
   * stay says what happened - the tent is gone, the grow is not. Emptying the
   * placement instead would read as standing in nothing right now, which is a
   * different and untrue thing.
   */
  it('ends somebody else´s stay in the space rather than emptying it', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.spaces.create({ id: 'our-tent', ownerId: leaving.id, kind: 'tent', name: 'Our tent' });
    await db.grows.create({
      id: 'their-grow',
      ownerId: staying.id,
      name: 'Theirs',
      type: 'photoperiod',
      slug: 'theirs',
      startedAt: new Date(),
      placements: [{ id: 'placement-1', spaceId: 'our-tent', startedAt: new Date(), endedAt: null }],
    });
    await db.devices.create({ id: 'their-device', type: 'fridge', ownerId: staying.id, spaceId: 'our-tent' });
    await db.cameras.create({ id: 'their-camera', ownerId: staying.id, kind: 'rtsp', name: 'Theirs', spaceId: 'our-tent' });

    await deletion.deleteAccount(leaving.id);

    const grow = await db.grows.findOne({ id: 'their-grow' }).lean();
    expect(grow?.placements[0].spaceId).toBe('our-tent');
    expect(grow?.placements[0].endedAt).toBeInstanceOf(Date);

    expect((await db.devices.findOne({ id: 'their-device' }).lean())?.spaceId).toBeNull();
    expect((await db.cameras.findOne({ id: 'their-camera' }).lean())?.spaceId).toBeNull();
  });
});

describe('the hardware', () => {
  const aDevice = async (ownerId: string): Promise<void> => {
    await db.devices.create({ id: 'device-1', type: 'controller', ownerId, spaceId: 'space-1', name: 'The tent' });
    await db.plans.create({ id: 'plan-1', deviceId: 'device-1', name: 'Nights off' });
    await db.alarmRules.create({ id: 'rule-1', deviceId: 'device-1', name: 'Too warm', metric: 'temperature', origin: 'human', severity: 'warning' });
    await db.alerts.create({ id: 'alert-1', ruleId: 'rule-1', deviceId: 'device-1', kind: 'threshold', severity: 'warning', startedAt: new Date() });
    await db.entries.create({ id: 'entry-device', kind: 'note', occurredAt: new Date(), source: 'device', deviceId: 'device-1', values: {} });
  };

  it('is handed back rather than deleted, carrying nothing of the previous owner', async () => {
    const leaving = await signUp('leaving');
    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    await aDevice(leaving.id);

    await deletion.deleteAccount(leaving.id);

    const device = await db.devices.findOne({ id: 'device-1' }).lean();
    // Unclaimed and nothing else: a claim asks after the owner and nothing more.
    expect(device).not.toBeNull();
    expect(device?.ownerId).toBeNull();
    expect(device?.spaceId).toBeNull();
    expect(device?.name).toBeNull();

    expect(await db.plans.countDocuments({})).toBe(0);
    expect(await db.alarmRules.countDocuments({})).toBe(0);
    expect(await db.alerts.countDocuments({})).toBe(0);
    expect(await db.entries.countDocuments({})).toBe(0);
  });

  /**
   * The camera row is deleted rather than marked removed, because a controller
   * reporting the same webcam again finds a row by its pairing id whether or not
   * it is dead and revives it - still naming the owner who is gone.
   */
  it('leaves no camera row for a later controller to revive', async () => {
    const leaving = await signUp('leaving');
    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    await aDevice(leaving.id);
    await db.cameras.create({ id: 'camera-1', ownerId: leaving.id, kind: 'terpcam_controller', name: 'Cam', deviceId: 'device-1', did: 'DID-1' });
    await db.media.create({ id: 'media-still', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: 'camera-1', capturedAt: new Date() });

    await deletion.deleteAccount(leaving.id);

    expect(await db.cameras.countDocuments({})).toBe(0);
    expect(await db.cameras.countDocuments({ did: 'DID-1' })).toBe(0);
    expect(await db.media.countDocuments({})).toBe(0);
  });
});

describe('the run itself', () => {
  it('refuses the account this install is configured with, and marks nothing', async () => {
    const admin = await accounts.signUp(AUTH.adminUsername, 'configured-admin', PASSWORD);

    const refused = await refusal(() => deletion.deleteAccount(admin.id));

    expect(refused.problem.code).toBe('admin_account_kept');
    expect((await db.users.findOne({ id: admin.id }).lean())?.deletionStartedAt).toBeNull();
  });

  it('says there is no such account, rather than deleting nothing quietly', async () => {
    expect((await refusal(() => deletion.deleteAccount('user-who-never-was'))).problem.code).toBe('user_not_found');
  });

  /**
   * There are no transactions here, so the marker is the whole record of a run
   * in flight. A run killed between two steps is found by it and finished with
   * the same steps that began it.
   */
  it('finishes a run that was interrupted after the marker was written', async () => {
    const leaving = await signUp('leaving');
    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    await db.grows.create({ id: 'grow-1', ownerId: leaving.id, name: 'A run', type: 'photoperiod', slug: 'a-run', startedAt: new Date() });

    const began = new Date(Date.now() - 60_000);
    await db.users.updateOne({ id: leaving.id }, { $set: { deletionStartedAt: began } });

    expect(await deletion.resumeUnfinished()).toBe(1);

    expect(await db.users.countDocuments({ id: leaving.id })).toBe(0);
    expect(await db.spaces.countDocuments({})).toBe(0);
    expect(await db.grows.countDocuments({})).toBe(0);
    expect(await deletion.resumeUnfinished()).toBe(0);
  });

  it('keeps the moment a run really began when it is picked up again', async () => {
    const leaving = await signUp('leaving');
    const began = new Date(Date.now() - 60_000);
    await db.users.updateOne({ id: leaving.id }, { $set: { deletionStartedAt: began } });

    await accounts.beginDeletion(leaving.id);

    expect((await db.users.findOne({ id: leaving.id }).lean())?.deletionStartedAt).toEqual(began);
  });

  it('will not sign a marked account in, so nothing writes into the half that is left', async () => {
    const leaving = await signUp('leaving');
    expect(await accounts.verify(leaving.email, PASSWORD)).not.toBeNull();

    await accounts.beginDeletion(leaving.id);

    expect(await accounts.verify(leaving.email, PASSWORD)).toBeNull();
  });
});
