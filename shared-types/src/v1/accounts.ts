import { z } from 'zod';
import { id, instant, named, notificationChannel, page, severity, subjectRef, unitPreference, webhookMethod } from './common.js';

/**
 * The account half of `/v1`: who somebody is, how they are signed in, and how
 * they are reached.
 *
 * Two fields carry the whole privacy rule of this domain. `email` is the login
 * identity: it is what a person signs in with, and it is never serialised to
 * anyone but its owner and an administrator. `handle` is the only name others
 * ever see - on a public grow, on a profile page, beside an entry somebody else
 * wrote - and no real name is stored anywhere.
 */

/** Stripped from shared views, so that a visitor sees a grow without its numbers. */
export const userPrivacy = named(
  'UserPrivacy',
  z.object({
    hideWeights: z.boolean(),
    hideCounts: z.boolean(),
  }),
);

/**
 * Display and scheduling. `units` is presentation only; `timezone` is an IANA
 * name and is also what quiet hours are read in, so it is a fact the server
 * needs rather than a client-side preference.
 */
export const userPreferences = named(
  'UserPreferences',
  z.object({
    units: unitPreference,
    locale: z.string(),
    timezone: z.string(),
  }),
);

/** How long raw climate points are kept; `null` keeps them for as long as the install does. */
export const userRetention = named(
  'UserRetention',
  z.object({
    climateDays: z.number().int().positive().nullable(),
  }),
);

/**
 * What the server sends. Transactional mail - activation, password reset - is
 * not routed and not listed.
 *
 * An alarm is two rows of the grid rather than one, because the two are wanted
 * on different channels: a tent that is too hot is `alerts` and goes wherever
 * somebody wants to be woken, a warning is `warnings` and is read in the
 * morning. Which row an alarm falls in is its rule's severity, and an alarm
 * whose severity is `info` is in neither - it stays in the inbox and is never
 * announced.
 */
export const notificationCategory = named('NotificationCategory', z.enum(['alerts', 'warnings', 'tasks', 'plan', 'weekly_timelapse']));

/**
 * A webhook the person owns. Its target and its headers are secrets - they can
 * name an internal host and carry an authorisation header - so they are on the
 * wire for their owner alone, on the account screens that set them, and appear
 * in no shared or public view. Per-alarm bodies and templates are a different
 * thing and live on the alarm rule's `delivery.custom`.
 */
export const webhookChannel = named(
  'WebhookChannel',
  z.object({
    url: z.string(),
    method: webhookMethod,
    headers: z.record(z.string(), z.string()),
  }),
);

/** The chat the install's bot answers in, and which a reply is matched back to. */
export const telegramChannel = named(
  'TelegramChannel',
  z.object({
    chatId: z.string(),
    linkedAt: instant(),
  }),
);

/**
 * The addresses. `null` is "not configured", which is also "off": the login
 * address is deliberately not used as a fallback, so that no notification goes
 * anywhere the person did not name.
 */
export const notificationChannels = named(
  'NotificationChannels',
  z.object({
    email: z.string().nullable(),
    telegram: telegramChannel.nullable(),
    webhook: webhookChannel.nullable(),
  }),
);

/**
 * The what-goes-where grid: every category names the channels it goes out on,
 * and `[]` is "this category is not announced at all".
 */
export const notificationRouting = named('NotificationRouting', z.record(notificationCategory, z.array(notificationChannel)));

/**
 * A wall-clock window in the person's own time zone, so it is minutes from
 * midnight rather than an instant - it has no date and no offset, and therefore
 * neither an ISO string nor an `...At` name. A window that crosses midnight has
 * `fromMinute` greater than `toMinute`. Critical alarms come through it.
 */
export const quietHours = named(
  'QuietHours',
  z.object({
    fromMinute: z.number().int().min(0).max(1439),
    toMinute: z.number().int().min(0).max(1439),
  }),
);

/** One send decision is made from this: mute, then quiet hours, then the routing. */
export const notificationSettings = named(
  'NotificationSettings',
  z.object({
    channels: notificationChannels,
    routing: notificationRouting,
    quietHours: quietHours.nullable(),
    mutedUntil: instant().nullable().describe('Mutes every category, critical alarms included, for this person only.'),
  }),
);

/**
 * The account, as `GET /admin/users` answers it. Its owner is answered `Me`
 * below, and a sign-up `SignupUser`.
 *
 * There is no password hash here and there is no field for one: this contract
 * describes what crosses the wire, a secret never does, and where the hash is
 * kept is the mongoose schema's business. `activationCode` is the one secret of
 * this shape that does cross, and only towards an administrator.
 */
export const user = named(
  'User',
  z.object({
    id: id(),
    createdAt: instant(),
    email: z.string(),
    isAdmin: z.boolean(),
    isActive: z.boolean(),
    // Only an account that signed itself up is sent one; an account an
    // administrator created has none. Serialised to an administrator alone,
    // because handing the code over is how such an account is activated.
    activationCode: z.string().nullable(),
    handle: z.string(),
    bio: z.string().nullable(),
    avatarMediaId: id().nullable(),
    publicProfile: z.boolean().describe('Whether /@handle answers with a page at all.'),
    privacy: userPrivacy,
    preferences: userPreferences,
    retention: userRetention,
    notifications: notificationSettings,
    deletionStartedAt: instant().nullable().describe('Set when deletion begins; it is resumable, so it outlives one request.'),
  }),
);

/**
 * What this install says about Premium, read from its configuration. `enforced`
 * is false in a self-hosted install, where nothing is gated; `extendUrl` and
 * `priceLabel` are what the renewal notice links to and says, which is why this
 * server needs no billing of its own.
 */
export const premium = named(
  'Premium',
  z.object({
    enforced: z.boolean(),
    extendUrl: z.string().nullable(),
    priceLabel: z.string().nullable(),
  }),
);

/**
 * `GET /me`: the account as its owner sees it, plus the three facts about the
 * install that the account screens need before they can offer anything - what
 * Premium costs here, the VAPID key a push subscription is made with, and
 * whether a Telegram bot is configured at all.
 */
export const me = named(
  'Me',
  user.omit({ activationCode: true }).extend({
    premium: premium,
    pushPublicKey: z.string().nullable().describe('VAPID public key; null until the install configures a key pair.'),
    telegramAvailable: z.boolean(),
    pushSubscribed: z.boolean().describe('Whether any browser of this account is subscribed to push, so a screen can say whether the push row of the grid goes anywhere.'),
  }),
);

/**
 * `PATCH /me`. Only what the person owns: the login address is the identity and
 * is not changed here, and `isAdmin`, `isActive` and the activation code are an
 * administrator's.
 */
export const meUpdate = named(
  'MeUpdate',
  user
    .pick({
      handle: true,
      bio: true,
      avatarMediaId: true,
      publicProfile: true,
      privacy: true,
      preferences: true,
      retention: true,
      notifications: true,
    })
    .partial(),
);

/**
 * A password on its way in. It travels in one direction only, so `User` has no
 * field to derive it from and it is stated here instead - once, for the five
 * bodies that carry one.
 *
 * Deliberately no more than "not empty". Strength is the server's rule and the
 * server's alone: a minimum written into the wire contract would also be applied
 * to the password somebody is signing *in* with, and lock out every account
 * whose password predates it.
 */
const password = () => z.string().min(1);

/** `PUT /me/password`. The current one is asked for again, because a stolen session must not be able to keep itself. */
export const passwordChange = named(
  'PasswordChange',
  z.object({
    currentPassword: password(),
    newPassword: password(),
  }),
);

/**
 * `POST /users`. A sign-up names its own handle, because it is the only name
 * this account will ever show and inventing one would only have to be corrected.
 */
export const userCreate = named('UserCreate', user.pick({ email: true, handle: true }).extend({ password: password() }));

/**
 * What a sign-up is told about the account it just made. Never the activation
 * code: the route is open, so anyone could otherwise activate an address they do
 * not own.
 */
export const signupUser = named('SignupUser', user.pick({ id: true, createdAt: true, email: true, handle: true, isActive: true }));

/**
 * `POST /users/activations`. The code is the whole proof, so nothing else is
 * asked for, and the route answers 204: the client signs in afterwards like
 * anyone else, rather than being handed a session by a code that arrived in a
 * mail somebody else may be reading.
 *
 * It is the account's own field, without the `null` that only the resource needs
 * - there an account that was never sent a code has none, here the code is the
 * entire request.
 */
export const userActivation = named('UserActivation', z.object({ activationCode: user.shape.activationCode.unwrap() }));

/**
 * One signed token and the instant it stops working. A duration would be the
 * other way of saying it; the instant is what a client can compare against its
 * own clock without having to remember when it asked.
 */
export const authToken = named(
  'AuthToken',
  z.object({
    token: z.string(),
    validUntil: instant(),
  }),
);

/**
 * The three tokens a session is made of: one to call with, one to renew it, one
 * for picture URLs. Handed once to the client that signed in and never answered
 * again - `GET /sessions` names a session by its id, which is not a secret.
 */
export const sessionTokens = named(
  'SessionTokens',
  z.object({
    userToken: authToken,
    refreshToken: authToken,
    mediaToken: authToken,
  }),
);

/**
 * A session, as `GET /sessions` lists it and `DELETE /sessions/{id}` revokes
 * it. Everything here is the server's own bookkeeping - there is nothing a
 * client writes - so unlike the resources that carry settings, a session has no
 * configuration to keep apart from its state.
 */
export const session = named(
  'Session',
  z.object({
    id: id(),
    createdAt: instant(),
    userId: id(),
    userAgent: z.string().nullable(),
    lastSeenAt: instant(),
    expiresAt: instant(),
  }),
);

export const sessionPage = named('SessionPage', page(session));

/** `POST /sessions`. The login identity is the e-mail address; there is no user name to remember. */
export const sessionCreate = named(
  'SessionCreate',
  user.pick({ email: true }).extend({
    password: password(),
    stayLoggedIn: z.boolean().optional().describe('Absent means a session that ends with the browser.'),
  }),
);

/**
 * Who the session belongs to, as the sign-in routes report it. Enough to draw
 * the shell - the rest of the account is `GET /me` - and `isDemo` says there is
 * no account behind it at all.
 */
export const sessionUser = named(
  'SessionUser',
  z.object({
    id: id(),
    handle: z.string(),
    isAdmin: z.boolean(),
    isDemo: z.boolean(),
  }),
);

/** What `POST /sessions` and `POST /sessions/demo` answer. The id is how this session revokes itself. */
export const sessionResult = named(
  'SessionResult',
  sessionTokens.extend({
    sessionId: id(),
    user: sessionUser,
  }),
);

/**
 * `POST /sessions/demo`: the tour of the demo objects, which needs no
 * credentials and therefore carries nothing. The empty body is named all the
 * same, so that the contract says "this route takes no arguments" rather than
 * leaving a client to guess what it forgot to send.
 */
export const demoSessionCreate = named('DemoSessionCreate', z.object({}));

/**
 * `POST /sessions/refresh`. The refresh token is spent and a fresh
 * `SessionTokens` triple comes back - not a `SessionResult`: the session and the
 * person behind it are the ones the client already knows.
 */
export const sessionRefresh = named('SessionRefresh', z.object({ refreshToken: z.string() }));

/** `POST /sessions/automation`. The token is the install's own, out of its configuration. */
export const automationSessionCreate = named('AutomationSessionCreate', z.object({ token: z.string() }));

/**
 * What the automation token buys: a short-lived administrator session and
 * nothing to renew it with, so a caller that needs longer asks again.
 */
export const automationSession = named('AutomationSession', sessionTokens.pick({ userToken: true }));

/**
 * `POST /password-resets`. Answered 202 with no body, the same way whether or
 * not the address has an account: what comes back must not tell a stranger who
 * is registered here.
 */
export const passwordResetCreate = named('PasswordResetCreate', user.pick({ email: true }));

/**
 * `POST /password-resets/{token}/redemptions`. The token is in the path, because
 * it is what was mailed. Answers 204 and no session, so that a reset link read
 * by somebody else is one more thing to sign in with rather than a way in.
 */
export const passwordResetRedemption = named('PasswordResetRedemption', z.object({ password: password() }));

/*
 * A pending reset has no shape here. Nothing of it is ever answered - the stored
 * record is the hashed half of what was mailed - and this contract describes
 * what crosses the wire, so the document's own shape belongs to the mongoose
 * schema instead.
 */

/** The Web Push keys the browser hands out with its endpoint. */
export const pushSubscriptionKeys = named(
  'PushSubscriptionKeys',
  z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
);

export const pushSubscription = named(
  'PushSubscription',
  z.object({
    id: id(),
    createdAt: instant(),
    userId: id(),
    endpoint: z.string(),
    keys: pushSubscriptionKeys,
    userAgent: z.string().nullable().describe('Which browser this subscription is, so that a person can tell two apart.'),
  }),
);

/** `POST /me/push-subscriptions`. The endpoint identifies it, so re-subscribing the same browser is an upsert. */
export const pushSubscriptionCreate = named('PushSubscriptionCreate', pushSubscription.pick({ endpoint: true, keys: true }));

/**
 * `POST /me/telegram-link`: the one-time link that connects a chat to this
 * account. The request carries nothing - the session says whose account it is -
 * and this is the answer. Opening the link starts the install's bot, which is
 * what produces the `chatId` in `NotificationChannels`.
 *
 * The URL carries the link secret, so it is answered to the person who asked for
 * it and to nobody else; whoever opens it gets the chat bound to this account.
 */
export const telegramLink = named(
  'TelegramLink',
  z.object({
    url: z.string(),
    validUntil: instant(),
  }),
);

/**
 * What was sent to whom. It is what keeps a due task from being announced
 * twice, and what maps a Telegram reply back to the thing it answers - hence
 * `externalMessageId`, which is the id the channel gave the message and is null
 * for a channel that gives none.
 */
export const notificationSubjectType = named('NotificationSubjectType', z.enum(['alert', 'task', 'plan', 'media']));

export const notificationLogEntry = named(
  'NotificationLogEntry',
  z.object({
    id: id(),
    createdAt: instant(),
    userId: id(),
    channel: notificationChannel,
    category: notificationCategory,
    subject: subjectRef(notificationSubjectType),
    externalMessageId: z.string().nullable(),
    sentAt: instant(),
    expiresAt: instant(),
  }),
);

export const exportStatus = named('ExportStatus', z.enum(['queued', 'running', 'ready', 'failed']));

/**
 * `GET /me/export`. Zipping a person's grows, their CSVs and their photos does
 * not finish inside a request, so the route answers this and it is polled until
 * `downloadUrl` is there.
 */
export const userExport = named(
  'UserExport',
  z.object({
    id: id(),
    createdAt: instant(),
    status: exportStatus,
    startedAt: instant().nullable(),
    endedAt: instant().nullable(),
    downloadUrl: z.string().nullable(),
    validUntil: instant().nullable().describe('When the finished file is swept; null while it is still being made.'),
    detail: z.string().nullable().describe('Why it failed; null otherwise.'),
  }),
);

/**
 * `GET /admin/users`. An administrator is the one other reader of an address and
 * the only reader of an activation code, which is all of `User` as it stands -
 * so there is no narrower admin shape to name, and the list is a page of users.
 */
export const adminUserPage = named('AdminUserPage', page(user));

/**
 * `POST /admin/users`. A sign-up plus the two flags only an administrator may
 * set; both are optional, and an account made this way is active at once and has
 * no activation code, because whoever created it can hand the password over.
 */
export const adminUserCreate = named(
  'AdminUserCreate',
  userCreate.extend(user.pick({ isAdmin: true, isActive: true }).partial().shape),
);

/**
 * `PATCH /admin/users/{id}`: the same fields, each only if it changes. `password`
 * among them, which is how an administrator resets one for somebody who cannot
 * receive the mail.
 */
export const adminUserUpdate = named('AdminUserUpdate', adminUserCreate.partial());

/**
 * What a Web Push carries, as the server encodes it and the service worker
 * reads it: the two lines of the announcement and what it is about. It is
 * named here because the worker in the browser and the channel on the server
 * are two ends of one wire, and a field renamed on one end would otherwise be
 * found by a push that shows nothing.
 */
export const pushPayload = named(
  'PushPayload',
  z.object({
    title: z.string(),
    body: z.string(),
    category: notificationCategory,
    subject: subjectRef(notificationSubjectType),
    severity: severity,
    // A week's film is watched on the page of the camera that shot it, and the
    // film's own id says nothing about which camera that is. Without this the
    // worker has nowhere to send a tap but the home screen.
    cameraId: id().nullable().describe('Where the subject is looked at, for a subject its own id cannot address.'),
  }),
);
