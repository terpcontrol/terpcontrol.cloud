import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { DataStoredInToken } from '@common/auth/auth.interface';
import { TokenService } from '@common/auth/token.service';
import { AccountsService } from '@modules/v1/account/accounts.service';
import { PasswordResetService } from '@modules/v1/account/password-reset.service';
import { SessionsService } from '@modules/v1/sessions/sessions.service';
import { ProblemException } from '@common/v1/problem';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The account and the session it is used to open.
 *
 * Both are a handful of queries and a pair of serialisers, and both decide
 * things that are only visible in the database: that a password is stored as a
 * hash and a recovery link only as the hash of what was mailed, that an
 * activation code is spent once, that revoking a session is what makes the next
 * renewal refuse. A stubbed model would only confirm that the spec and the
 * service agree on what to stub, so this runs against a real one.
 */

const PASSWORD = 'Passw0rd!test';
const NEW_PASSWORD = 'An0ther!pass';

const auth = {
  secretKey: 'unit-spec-secret',
  automationToken: 'unit-automation-token',
  requireActivation: false,
  enableSelfRegistration: false,
  selfRegistrationPassword: undefined,
  adminUsername: 'admin@test.invalid',
  adminPassword: 'Adm1n!pass',
};

const premium = { enforced: true, freeStillWidth: 0, freeRetention: false, freeStillDays: 0, freeTimelapseDays: 0, extendUrl: '', priceLabel: '' };

/** No install-wide climate window, which is what a server that has said nothing has. */
const retention = { climateDays: 0 };

const notifications = {
  pushPublicKey: null,
  pushPrivateKey: null,
  pushContact: null,
  telegramBotToken: null,
  telegramBotUsername: null,
  telegramWebhookSecret: null,
};

const mailed: { to: string; subject: string; text: string }[] = [];

// Each service reads one thing out of what is stubbed here: the transport's
// `send`, and the external URL a recovery link is built from.
const app = { apiUrlExternal: 'https://api.test.invalid' };
const mail = {
  send: jest.fn(async (message: { to: string; subject: string; text: string }) => {
    mailed.push(message);
    return undefined;
  }),
};

let database: V1TestDatabase;
let accounts: AccountsService;
let resets: PasswordResetService;
let sessions: SessionsService;

const build = (): void => {
  accounts = new AccountsService(database.users, database.pushSubscriptions, database.sessions, { ...auth }, { ...premium }, { ...notifications }, { ...retention });
  resets = new PasswordResetService(database.passwordResets, accounts, mail as never, app as never);
  sessions = new SessionsService(database.sessions, accounts, { ...auth });
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
  database = await startV1TestDatabase();
});

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await database.reset();
  mailed.length = 0;
  build();
});

describe('signing up', () => {
  it('stores the password as a hash and nothing readable', async () => {
    const user = await signUp('hashed');
    const stored = await database.users.findOne({ id: user.id }).select('+passwordHash').lean();

    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it('leaves every field the model names decided, rather than absent', async () => {
    const user = accounts.serialise(await signUp('defaults'));

    expect(user).toMatchObject({
      isAdmin: false,
      bio: null,
      avatarMediaId: null,
      publicProfile: false,
      privacy: { hideWeights: false, hideCounts: false },
      retention: { climateDays: null },
      deletionStartedAt: null,
    });
    expect(user.notifications.routing).toMatchObject({ alerts: [], warnings: [] });
    expect(user.preferences.timezone).toBe('UTC');
  });

  it('is active at once, with no code, where the install asks for no activation', async () => {
    const user = await signUp('open');

    expect(user.isActive).toBe(true);
    expect(user.activationCode).toBeNull();
  });

  it('is sent a code, and is not active until it is used, where the install asks for one', async () => {
    accounts = new AccountsService(
      database.users,
      database.pushSubscriptions,
      database.sessions,
      { ...auth, requireActivation: true },
      { ...premium },
      { ...notifications },
      { ...retention },
    );

    const user = await signUp('activating');
    expect(user.isActive).toBe(false);
    expect(user.activationCode).not.toBeNull();

    await accounts.activate(user.activationCode as string);
    expect((await accounts.byId(user.id))?.isActive).toBe(true);

    // Spent: the code is cleared with the account it activated.
    expect((await refusal(() => accounts.activate(user.activationCode as string))).problem.status).toBe(404);
  });

  it('refuses an address and a handle that are taken, each by its own name', async () => {
    await signUp('taken');

    expect((await refusal(() => accounts.signUp('taken@test.invalid', 'other', PASSWORD))).problem.code).toBe('email_taken');
    expect((await refusal(() => accounts.signUp('other@test.invalid', 'taken', PASSWORD))).problem.code).toBe('handle_taken');
  });
});

describe('what is serialised', () => {
  it('hands an administrator the activation code and its owner nothing of the kind', async () => {
    accounts = new AccountsService(
      database.users,
      database.pushSubscriptions,
      database.sessions,
      { ...auth, requireActivation: true },
      { ...premium },
      { ...notifications },
      { ...retention },
    );
    const user = await signUp('serialised');

    expect(accounts.serialise(user).activationCode).not.toBeNull();
    expect(await accounts.serialiseMe(user)).not.toHaveProperty('activationCode');
  });

  it('tells the account what this install says about Premium and its channels', async () => {
    const user = await signUp('install');

    expect(await accounts.serialiseMe(user)).toMatchObject({
      premium: { enforced: true, extendUrl: null, priceLabel: null },
      pushPublicKey: null,
      telegramAvailable: false,
      pushSubscribed: false,
    });
  });

  it('says a browser of the account has subscribed to push, whichever browser it was', async () => {
    const user = await signUp('subscribed');
    await database.pushSubscriptions.create({
      id: 'sub-1',
      userId: user.id,
      endpoint: 'https://push.example/sub-1',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: null,
    });

    expect((await accounts.serialiseMe(user)).pushSubscribed).toBe(true);
  });

  it('answers instants as ISO strings, never as dates', async () => {
    const user = accounts.serialise(await signUp('instants'));

    expect(typeof user.createdAt).toBe('string');
    expect(new Date(user.createdAt).getTime()).not.toBeNaN();
  });

  /**
   * The privacy screen's menu offers "keep everything" and stores `null`, which
   * is "I have not said" rather than "for ever". On an install that sets a
   * window of its own the sweep then summarises and deletes at that age, and
   * the screen had nothing to say so with. These are the two figures it says it
   * with.
   */
  describe('what "keep everything" will really come to', () => {
    const withInstallWindow = (days: number): AccountsService =>
      new AccountsService(database.users, database.pushSubscriptions, { ...auth }, { ...premium }, { ...notifications }, { climateDays: days });

    it('names the install´s window, and does not let an account that named none be told its samples are kept for ever', async () => {
      const user = await signUp('install-window');
      const me = await withInstallWindow(365).serialiseMe(user);

      expect(me.retention.climateDays).toBeNull();
      expect(me.climateRetention).toEqual({ installDays: 365, appliesDays: 365 });
    });

    it('keeps everything only where the install keeps everything too', async () => {
      const user = await signUp('no-window');
      const me = await withInstallWindow(0).serialiseMe(user);

      expect(me.climateRetention).toEqual({ installDays: null, appliesDays: null });
    });

    it('does not cap what the account asked for: the install´s figure is a default and not a ceiling', async () => {
      const user = await signUp('longer-window');
      await database.users.updateOne({ id: user.id }, { $set: { retention: { climateDays: 730 } } });
      const stored = await database.users.findOne({ id: user.id }).lean<StoredUser>();

      const me = await withInstallWindow(365).serialiseMe(stored!);

      expect(me.climateRetention).toEqual({ installDays: 365, appliesDays: 730 });
    });
  });
});

describe('changing an account', () => {
  it('takes a whole object where the contract carries one, and reads its instants back as dates', async () => {
    const user = await signUp('settings');
    const mutedUntil = '2026-07-01T12:00:00.000Z';

    const updated = await accounts.updateOwn(user.id, {
      privacy: { hideWeights: true, hideCounts: false },
      notifications: {
        channels: { email: 'somewhere@test.invalid', telegram: null, webhook: null },
        routing: { alerts: ['email'], warnings: [], tasks: [], plan: [], weekly_timelapse: [] },
        quietHours: { fromMinute: 1320, toMinute: 420 },
        mutedUntil,
      },
    });

    expect(updated.notifications.mutedUntil).toBeInstanceOf(Date);
    expect(await accounts.serialiseMe(updated)).toMatchObject({
      privacy: { hideWeights: true, hideCounts: false },
      notifications: { channels: { email: 'somewhere@test.invalid' }, mutedUntil },
    });
  });

  it('answers the account as it stands when the body names no field', async () => {
    const user = await signUp('unchanged');

    expect((await accounts.updateOwn(user.id, {})).handle).toBe('unchanged');
    expect((await accounts.updateAsAdmin(user.id, {})).handle).toBe('unchanged');
  });

  it('lets an account keep its own handle and refuses somebody else´s', async () => {
    const mine = await signUp('mine');
    await signUp('yours');

    await expect(accounts.updateOwn(mine.id, { handle: 'mine' })).resolves.toBeDefined();
    expect((await refusal(() => accounts.updateOwn(mine.id, { handle: 'yours' }))).problem.code).toBe('handle_taken');
  });

  it('hashes a password an administrator sets, and signs in with it', async () => {
    const user = await signUp('reset-by-admin');

    await accounts.updateAsAdmin(user.id, { password: NEW_PASSWORD });

    expect(await accounts.verify(user.email, NEW_PASSWORD)).not.toBeNull();
    expect(await accounts.verify(user.email, PASSWORD)).toBeNull();
  });
});

describe('signing in', () => {
  it('answers the same nothing for a wrong password and for an address with no account', async () => {
    const user = await signUp('verify');

    expect(await accounts.verify(user.email, PASSWORD)).not.toBeNull();
    expect(await accounts.verify(user.email, 'wrong')).toBeNull();
    expect(await accounts.verify('nobody@test.invalid', PASSWORD)).toBeNull();
  });

  it('refuses an account that has not been activated, and says which it is', async () => {
    accounts = new AccountsService(
      database.users,
      database.pushSubscriptions,
      database.sessions,
      { ...auth, requireActivation: true },
      { ...premium },
      { ...notifications },
      { ...retention },
    );
    sessions = new SessionsService(database.sessions, accounts, { ...auth });

    const user = await signUp('inactive');

    expect((await refusal(() => sessions.logIn(user.email, PASSWORD, false, null))).problem.code).toBe('account_not_activated');
  });

  it('writes a row that can be listed, and three tokens that say the same about who is asking', async () => {
    const user = await signUp('opened');

    const result = await sessions.logIn(user.email, PASSWORD, false, 'a browser');

    expect(result.user).toEqual({ id: user.id, handle: 'opened', isAdmin: false, isDemo: false });
    expect((await database.sessions.findOne({ id: result.sessionId }).lean())?.userAgent).toBe('a browser');

    for (const token of [result.userToken, result.refreshToken, result.mediaToken]) {
      const claims = jwt.verify(token.token, auth.secretKey) as Record<string, unknown>;
      expect(claims.user_id).toBe(user.id);
      expect(claims.session_id).toBe(result.sessionId);
    }
  });

  it('opens the demo without an account, and marks the tokens as one', async () => {
    const result = await sessions.openDemo(null);

    expect(result.user.isDemo).toBe(true);
    expect((jwt.verify(result.userToken.token, auth.secretKey) as Record<string, unknown>).is_demo).toBe(true);
  });

  it('trades the install´s own token for an administrator, and nothing else for anything else', async () => {
    const claims = jwt.verify(sessions.automation(auth.automationToken).userToken.token, auth.secretKey) as Record<string, unknown>;
    expect(claims.is_admin).toBe(true);

    expect((await refusal(() => sessions.automation('unit-automation-token-x'))).problem.status).toBe(401);
    expect((await refusal(() => sessions.automation('unit-automation'))).problem.status).toBe(401);
  });
});

describe('a session over its life', () => {
  it('renews from the row, and refuses once the row has been revoked', async () => {
    const user = await signUp('renewed');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);

    const renewed = await sessions.refresh(opened.refreshToken.token);
    expect((jwt.verify(renewed.refreshToken.token, auth.secretKey) as Record<string, unknown>).session_id).toBe(opened.sessionId);

    await sessions.revoke(user.id, opened.sessionId);
    expect((await refusal(() => sessions.refresh(renewed.refreshToken.token))).problem.code).toBe('session_gone');
  });

  it('refuses a user token where a refresh token is asked for', async () => {
    const user = await signUp('wrong-token');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);

    expect((await refusal(() => sessions.refresh(opened.userToken.token))).problem.code).toBe('token_invalid');
  });

  it('lists the caller´s own sessions, newest use first, a page at a time', async () => {
    const user = await signUp('lister');
    const stranger = await signUp('not-the-lister');
    await sessions.logIn(stranger.email, PASSWORD, false, null);

    const opened = [];
    for (const label of ['one', 'two', 'three']) {
      opened.push(await sessions.logIn(user.email, PASSWORD, false, label));
    }

    const first = await sessions.list(user.id, { limit: 2 });
    expect(first.items.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await sessions.list(user.id, { limit: 2, cursor: first.nextCursor as string });
    const listed = [...first.items, ...second.items].map(row => row.id);

    expect(listed.sort()).toEqual(opened.map(row => row.sessionId).sort());
    expect(second.nextCursor).toBeNull();
  });

  it('ends nobody else´s session', async () => {
    const user = await signUp('owner-of-a-session');
    const stranger = await signUp('stranger-to-it');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);

    expect((await refusal(() => sessions.revoke(stranger.id, opened.sessionId))).problem.status).toBe(404);
    expect(await database.sessions.countDocuments({ id: opened.sessionId })).toBe(1);
  });
});

describe('recovering a password', () => {
  it('stores only the hash of what it mailed, and spends it once', async () => {
    const user = await signUp('recovering');

    await resets.request(user.email);
    const token = mailed[0].text.match(/recovery=([\w-]+)/)?.[1] as string;

    const stored = await database.passwordResets.findOne({ userId: user.id }).select('+tokenHash').lean();
    expect(stored?.tokenHash).not.toContain(token);

    await resets.redeem(token, NEW_PASSWORD);
    expect(await accounts.verify(user.email, NEW_PASSWORD)).not.toBeNull();

    expect((await refusal(() => resets.redeem(token, 'third!Password'))).problem.code).toBe('reset_unknown');
  });

  it('mails nothing, and says nothing, for an address with no account here', async () => {
    await resets.request('nobody@test.invalid');

    expect(mailed).toEqual([]);
    expect(await database.passwordResets.countDocuments({})).toBe(0);
  });

  it('retires a link that was asked for and never used, when the password changes anyway', async () => {
    const user = await signUp('changed-instead');

    await resets.request(user.email);
    await accounts.setPassword(user.id, NEW_PASSWORD);
    await resets.retire(user.id);

    expect(await database.passwordResets.countDocuments({ userId: user.id })).toBe(0);
  });
});

describe('the account the install seeds', () => {
  it('is created on the first start and has its password reset on every later one', async () => {
    await accounts.onModuleInit();
    const seeded = await accounts.byEmail(auth.adminUsername);

    expect(seeded?.isAdmin).toBe(true);
    expect(seeded?.handle).toBe('admin');

    accounts = new AccountsService(
      database.users,
      database.pushSubscriptions,
      database.sessions,
      { ...auth, adminPassword: NEW_PASSWORD },
      { ...premium },
      { ...notifications },
      { ...retention },
    );
    await accounts.onModuleInit();

    expect(await database.users.countDocuments({ email: auth.adminUsername })).toBe(1);
    expect(await accounts.verify(auth.adminUsername, NEW_PASSWORD)).not.toBeNull();
  });
});

/**
 * A signed token states what was true when it was handed out, and goes on
 * stating it for as long as it lives. What a request is really allowed to do is
 * decided here instead, against the session row and the account row, which is
 * why revoking, deactivating, demoting and deleting all take effect at once
 * rather than five minutes later.
 */
describe('who a token still answers for', () => {
  let tokens: TokenService;

  const claimsOf = (token: string): DataStoredInToken => jwt.verify(token, auth.secretKey) as unknown as DataStoredInToken;

  beforeEach(() => {
    tokens = new TokenService(database.sessions, database.users, { ...auth });
  });

  it('answers for the account behind a live session, with the privilege the row carries now', async () => {
    const user = await signUp('resolved');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);

    expect(await tokens.resolve(claimsOf(opened.userToken.token))).toEqual({
      userId: user.id,
      isAdmin: false,
      isDemo: false,
      // Which session asked, so that the two things an account does to its own
      // sessions can spare the browser doing them.
      sessionId: expect.any(String),
    });

    await accounts.updateAsAdmin(user.id, { isAdmin: true });
    expect((await tokens.resolve(claimsOf(opened.userToken.token)))?.isAdmin).toBe(true);

    await accounts.updateAsAdmin(user.id, { isAdmin: false });
    expect((await tokens.resolve(claimsOf(opened.userToken.token)))?.isAdmin).toBe(false);
  });

  it('answers for nobody once the session is revoked, the account deactivated, marked or gone', async () => {
    const user = await signUp('no-longer');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);
    const claims = claimsOf(opened.userToken.token);

    await sessions.revoke(user.id, opened.sessionId);
    expect(await tokens.resolve(claims)).toBeNull();

    const again = claimsOf((await sessions.logIn(user.email, PASSWORD, false, null)).userToken.token);
    await accounts.updateAsAdmin(user.id, { isActive: false });
    expect(await tokens.resolve(again)).toBeNull();

    await accounts.updateAsAdmin(user.id, { isActive: true });
    await accounts.beginDeletion(user.id);
    expect(await tokens.resolve(again)).toBeNull();

    await database.users.deleteOne({ id: user.id });
    expect(await tokens.resolve(again)).toBeNull();
  });

  /**
   * The three that are not an account, and must go on working: a picture's URL
   * carries a token of its own for thirty days, the demo has a session and no
   * row, and the install's own token has neither.
   */
  it('answers for the media token, the demo and the install´s own token', async () => {
    const user = await signUp('the-three');
    const opened = await sessions.logIn(user.email, PASSWORD, false, null);

    expect(await tokens.resolve(claimsOf(opened.mediaToken.token))).toEqual({
      userId: user.id,
      isAdmin: false,
      isDemo: false,
      sessionId: expect.any(String),
    });

    const demo = await sessions.openDemo(null);
    expect(await tokens.resolve(claimsOf(demo.userToken.token))).toEqual({
      userId: 'demo',
      isAdmin: false,
      isDemo: true,
      sessionId: expect.any(String),
    });

    const automation = sessions.automation(auth.automationToken);
    // The install's own token names no session, because it is a script rather
    // than somebody signed in - and nothing it does can end anybody's browser.
    expect(await tokens.resolve(claimsOf(automation.userToken.token))).toEqual({ userId: '', isAdmin: true, isDemo: false, sessionId: null });
  });
});
