import { jest } from '@jest/globals';
import { Model } from 'mongoose';
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
 *
 * A row is the account's own when nothing else is a parent of it, which is the
 * same reachability the daily sweep decides by. So a second account is in most
 * of these fixtures, and what belongs to it is asserted present as carefully as
 * what belongs to the first is asserted gone.
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
const NOTIFICATIONS = {
  pushPublicKey: null,
  pushPrivateKey: null,
  pushContact: null,
  telegramBotToken: null,
  telegramBotUsername: null,
  telegramWebhookSecret: null,
};
const PASSWORD = 'Passw0rd!test';

let db: V1TestDatabase;
let accounts: AccountsService;
let deletion: AccountDeletionService;

const build = (): void => {
  accounts = new AccountsService(db.users, db.pushSubscriptions, db.sessions, { ...AUTH }, { ...PREMIUM }, { ...NOTIFICATIONS }, { climateDays: 0 });

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

// The services are rebuilt for every spec, but the models are not: a spy on one
// of them would otherwise be the next spec's problem.
afterEach(() => {
  jest.restoreAllMocks();
});

describe('what the account owns', () => {
  it('goes, down to the collections nothing has a route for', async () => {
    const leaving = await signUp('leaving');

    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    await db.grows.create({ id: 'grow-1', ownerId: leaving.id, name: 'A run', type: 'photoperiod', slug: 'a-run', startedAt: new Date() });
    await db.plants.create({ id: 'plant-1', growId: 'grow-1', strain: 'Amnesia', label: '1' });
    await db.chartViews.create({
      id: 'chart-1',
      ownerId: leaving.id,
      name: 'Week',
      definition: { span: { kind: 'last', forSeconds: 7 * 24 * 60 * 60 }, intervalSeconds: 300 },
    });
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
   * A space is one of several places a row can stand in, and never the only one.
   * A line, a picture or an alert that happened in this tent but also names a
   * grow, a device or a camera stands on that timeline too - and that timeline
   * is somebody else's here, and outlives the tent.
   */
  it('keeps what merely happened in the space but belongs to somebody else´s grow, device or camera', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.spaces.create({ id: 'our-tent', ownerId: leaving.id, kind: 'tent', name: 'Our tent' });
    await db.grows.create({ id: 'their-grow', ownerId: staying.id, name: 'Theirs', type: 'photoperiod', slug: 'theirs', startedAt: new Date() });
    await db.devices.create({ id: 'their-device', type: 'fridge', ownerId: staying.id, spaceId: 'our-tent' });
    await db.cameras.create({ id: 'their-camera', ownerId: staying.id, kind: 'rtsp', name: 'Theirs', spaceId: 'our-tent' });

    const aLine = (id: string, about: Record<string, string>) =>
      db.entries.create({ id, kind: 'note', occurredAt: new Date(), source: 'human', spaceId: 'our-tent', values: {}, ...about });
    await aLine('line-their-grow', { growId: 'their-grow' });
    await aLine('line-their-device', { deviceId: 'their-device' });
    await aLine('line-their-camera', { cameraId: 'their-camera' });
    await aLine('line-the-tent-only', {});

    const aPicture = (id: string, about: Record<string, string>) =>
      db.media.create({ id, kind: 'photo', mime: 'image/jpeg', bytes: 1, spaceId: 'our-tent', capturedAt: new Date(), ...about });
    await aPicture('picture-their-grow', { growId: 'their-grow' });
    await aPicture('picture-their-camera', { cameraId: 'their-camera' });
    await aPicture('picture-the-tent-only', {});

    const anAlert = (id: string, about: Record<string, string>) =>
      db.alerts.create({ id, kind: 'threshold', severity: 'warning', startedAt: new Date(), spaceId: 'our-tent', ...about });
    await anAlert('alert-their-device', { deviceId: 'their-device' });
    await anAlert('alert-their-camera', { cameraId: 'their-camera' });
    await anAlert('alert-the-tent-only', {});

    await deletion.deleteAccount(leaving.id);

    const left = async (model: Model<{ id: string }>): Promise<string[]> => (await model.distinct('id', {})).sort();

    expect(await left(db.entries as never)).toEqual(['line-their-camera', 'line-their-device', 'line-their-grow']);
    expect(await left(db.media as never)).toEqual(['picture-their-camera', 'picture-their-grow']);
    expect(await left(db.alerts as never)).toEqual(['alert-their-camera', 'alert-their-device']);
  });

  /**
   * A grow's cover and its film are set to whatever the request names, and
   * nothing checks whose picture that is - so what a grow points at is not proof
   * that the grow's owner ever owned it.
   */
  it('purges the pictures a grow names only where the account is the one who put them there', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.media.create({ id: 'picture-ours', kind: 'photo', mime: 'image/jpeg', bytes: 1, uploadedBy: leaving.id, capturedAt: new Date() });
    await db.media.create({ id: 'picture-theirs', kind: 'photo', mime: 'image/jpeg', bytes: 1, uploadedBy: staying.id, capturedAt: new Date() });
    await db.grows.create({
      id: 'grow-1',
      ownerId: leaving.id,
      name: 'A run',
      type: 'photoperiod',
      slug: 'a-run',
      startedAt: new Date(),
      filmMediaId: 'picture-ours',
      coverMediaId: 'picture-theirs',
    });

    await deletion.deleteAccount(leaving.id);

    expect(await db.media.countDocuments({ id: 'picture-ours' })).toBe(0);
    const theirs = await db.media.findOne({ id: 'picture-theirs' }).lean();
    expect(theirs?.uploadedBy).toBe(staying.id);
  });

  /**
   * An invitation and a recurring task belong to the place they were made in
   * rather than to whoever typed them: a manager in somebody else's space leaves
   * behind an invitation its owner was told nothing about and a task the whole
   * space follows, and neither is the author's to withdraw on the way out.
   */
  it('hands an invitation and a task made in somebody else´s place to whoever owns it', async () => {
    const leaving = await signUp('leaving');
    const staying = await signUp('staying');

    await db.spaces.create({ id: 'our-tent', ownerId: leaving.id, kind: 'tent', name: 'Our tent' });
    await db.spaces.create({ id: 'their-tent', ownerId: staying.id, kind: 'tent', name: 'Their tent' });
    await db.grows.create({ id: 'their-grow', ownerId: staying.id, name: 'Theirs', type: 'photoperiod', slug: 'theirs', startedAt: new Date() });

    const anInvite = (id: string, spaceId: string) => db.invites.create({ id, code: `code-${id}`, spaceId, role: 'can_log', createdBy: leaving.id });
    await anInvite('invite-theirs', 'their-tent');
    await anInvite('invite-ours', 'our-tent');
    await anInvite('invite-nowhere', 'a-tent-that-is-gone');

    const aTask = (id: string, subject: { type: 'grow' | 'space'; id: string }) =>
      db.reminders.create({ id, subject, kind: 'water', label: 'Water', everyDays: 3, createdBy: leaving.id });
    await aTask('task-their-tent', { type: 'space', id: 'their-tent' });
    await aTask('task-their-grow', { type: 'grow', id: 'their-grow' });
    await aTask('task-ours', { type: 'space', id: 'our-tent' });
    await aTask('task-nowhere', { type: 'grow', id: 'a-grow-that-is-gone' });

    await deletion.deleteAccount(leaving.id);

    expect((await db.invites.findOne({ id: 'invite-theirs' }).lean())?.createdBy).toBe(staying.id);
    expect((await db.reminders.findOne({ id: 'task-their-tent' }).lean())?.createdBy).toBe(staying.id);
    expect((await db.reminders.findOne({ id: 'task-their-grow' }).lean())?.createdBy).toBe(staying.id);

    // The account's own places went with it, and so did what stood in them;
    // what stands in no place at all can be reached by nobody and goes too.
    expect(await db.invites.countDocuments({ id: { $in: ['invite-ours', 'invite-nowhere'] } })).toBe(0);
    expect(await db.reminders.countDocuments({ id: { $in: ['task-ours', 'task-nowhere'] } })).toBe(0);
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
    await db.alarmRules.create({
      id: 'rule-1',
      deviceId: 'device-1',
      name: 'Too warm',
      watch: { kind: 'reading', metric: 'temperature', upper: 30 },
      origin: 'human',
      severity: 'warning',
    });
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

  /**
   * The marker is what a resumed run is found by, and the writes that take the
   * account off the internet need nothing it says - so they come first. A run
   * that dies at the marker has still signed the account out and unpublished
   * what it published, rather than leaving a deleted person's diary served
   * until the next boot.
   */
  it('has already signed the account out and unpublished its diary when the marker fails', async () => {
    const leaving = await signUp('leaving');
    await db.sessions.create({ id: 'session-1', userId: leaving.id, expiresAt: new Date(Date.now() + 60_000) });
    await db.grows.create({
      id: 'grow-1',
      ownerId: leaving.id,
      name: 'A run',
      type: 'photoperiod',
      slug: 'a-run',
      startedAt: new Date(),
      visibility: 'public',
    });
    await db.shareLinks.create({ id: 'link-1', token: 'a-token', kind: 'view', subject: { type: 'grow', id: 'grow-1' }, createdBy: leaving.id });

    jest.spyOn(accounts, 'beginDeletion').mockRejectedValueOnce(new Error('killed at the marker'));
    await expect(deletion.deleteAccount(leaving.id)).rejects.toThrow('killed at the marker');

    expect((await db.grows.findOne({ id: 'grow-1' }).lean())?.visibility).toBe('private');
    expect(await db.sessions.countDocuments({ userId: leaving.id })).toBe(0);
    expect(await db.shareLinks.countDocuments({ createdBy: leaving.id })).toBe(0);
  });

  /**
   * The invariant belongs to the row rather than to the route: the boot sweep
   * reads the marked rows and no route is between it and them.
   */
  it('refuses the account this install is configured with even when its row is already marked', async () => {
    const admin = await accounts.signUp(AUTH.adminUsername, 'configured-admin', PASSWORD);
    await db.spaces.create({ id: 'space-1', ownerId: admin.id, kind: 'tent', name: 'Tent' });
    await db.users.updateOne({ id: admin.id }, { $set: { deletionStartedAt: new Date() } });

    await deletion.resumeUnfinished();

    expect(await db.users.countDocuments({ id: admin.id })).toBe(1);
    expect(await db.spaces.countDocuments({ id: 'space-1' })).toBe(1);
  });

  it('finishes the other accounts when one of them cannot be finished', async () => {
    const broken = await signUp('unreadable');
    const leaving = await signUp('leaving');
    await db.spaces.create({ id: 'space-1', ownerId: leaving.id, kind: 'tent', name: 'Tent' });
    for (const id of [broken.id, leaving.id]) await accounts.beginDeletion(id);

    const readable = accounts.byId.bind(accounts);
    jest.spyOn(accounts, 'byId').mockImplementation(async id => {
      if (id === broken.id) throw new Error('that row cannot be read');
      return readable(id);
    });

    expect(await deletion.resumeUnfinished()).toBe(2);

    expect(await db.users.countDocuments({ id: leaving.id })).toBe(0);
    expect(await db.spaces.countDocuments({})).toBe(0);
    expect(await db.users.countDocuments({ id: broken.id })).toBe(1);
  });

  /**
   * The account's own subject-less rows are found by the very fields that
   * emptying the attribution rewrites, so emptying must never reach them: a run
   * that stopped after doing so would leave them named by nobody, and no later
   * pass could ever find them again.
   */
  it('leaves the account´s own orphans named by it, so a resumed run still finds them', async () => {
    const leaving = await signUp('leaving');
    await db.media.create({ id: 'picture-loose', kind: 'photo', mime: 'image/jpeg', bytes: 1, uploadedBy: leaving.id, capturedAt: new Date() });
    await db.entries.create({ id: 'line-loose', kind: 'note', occurredAt: new Date(), source: 'human', authorId: leaving.id, values: {} });

    // A delete that removes nothing is a case the purge tolerates rather than
    // loops on, so the run carries on past the pictures it did not get.
    const purged = jest.spyOn(db.media, 'deleteMany').mockReturnValueOnce(Promise.resolve({ acknowledged: true, deletedCount: 0 }) as never);
    const removed = jest.spyOn(accounts, 'remove').mockRejectedValueOnce(new Error('killed before the row went'));

    await expect(deletion.deleteAccount(leaving.id)).rejects.toThrow('killed before the row went');
    purged.mockRestore();
    removed.mockRestore();

    expect((await db.media.findOne({ id: 'picture-loose' }).lean())?.uploadedBy).toBe(leaving.id);

    expect(await deletion.resumeUnfinished()).toBe(1);
    expect(await db.media.countDocuments({ id: 'picture-loose' })).toBe(0);
    expect(await db.entries.countDocuments({ id: 'line-loose' })).toBe(0);
    expect(await db.users.countDocuments({ id: leaving.id })).toBe(0);
  });

  /**
   * The bytes go before the row that indexes them. A pass that dies in between
   * leaves a row whose file is gone, which the next pass deletes and which
   * nothing else ever reads; the other order leaves a file no row names, which
   * nothing in the run could find again.
   */
  it('frees a picture´s bytes before the row, so a pass that dies strands no file', async () => {
    const leaving = await signUp('leaving');
    await db.media.create({ id: 'picture-loose', kind: 'photo', mime: 'image/jpeg', bytes: 1, uploadedBy: leaving.id, capturedAt: new Date() });
    await db.connection.db!.collection('imagedata.files').insertOne({ _id: 'picture-loose' as never, length: 1, filename: 'picture-loose' });

    const purged = jest.spyOn(db.media, 'deleteMany').mockImplementationOnce(() => {
      throw new Error('killed between the bytes and the row');
    });
    await expect(deletion.deleteAccount(leaving.id)).rejects.toThrow('killed between the bytes and the row');
    purged.mockRestore();

    expect(await db.connection.db!.collection('imagedata.files').countDocuments({ _id: 'picture-loose' as never })).toBe(0);
    expect(await db.media.countDocuments({ id: 'picture-loose' })).toBe(1);

    expect(await deletion.resumeUnfinished()).toBe(1);
    expect(await db.media.countDocuments({ id: 'picture-loose' })).toBe(0);
  });
});
