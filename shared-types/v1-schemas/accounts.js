"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminUserUpdate = exports.adminUserCreate = exports.adminUserPage = exports.userExport = exports.exportStatus = exports.notificationLogEntry = exports.notificationSubjectType = exports.telegramLink = exports.pushSubscriptionCreate = exports.pushSubscription = exports.pushSubscriptionKeys = exports.passwordResetRedemption = exports.passwordResetCreate = exports.automationSession = exports.automationSessionCreate = exports.sessionRefresh = exports.demoSessionCreate = exports.sessionResult = exports.sessionUser = exports.sessionCreate = exports.sessionPage = exports.session = exports.sessionTokens = exports.authToken = exports.userActivation = exports.signupUser = exports.userCreate = exports.passwordChange = exports.meUpdate = exports.me = exports.premium = exports.user = exports.notificationSettings = exports.quietHours = exports.notificationRouting = exports.notificationChannels = exports.telegramChannel = exports.webhookChannel = exports.notificationCategory = exports.userRetention = exports.userPreferences = exports.userPrivacy = void 0;
const zod_1 = require("zod");
const common_js_1 = require("./common.js");
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
exports.userPrivacy = (0, common_js_1.named)('UserPrivacy', zod_1.z.object({
    hideWeights: zod_1.z.boolean(),
    hideCounts: zod_1.z.boolean(),
}));
/**
 * Display and scheduling. `units` is presentation only; `timezone` is an IANA
 * name and is also what quiet hours are read in, so it is a fact the server
 * needs rather than a client-side preference.
 */
exports.userPreferences = (0, common_js_1.named)('UserPreferences', zod_1.z.object({
    units: common_js_1.unitPreference,
    locale: zod_1.z.string(),
    timezone: zod_1.z.string(),
}));
/** How long raw climate points are kept; `null` keeps them for as long as the install does. */
exports.userRetention = (0, common_js_1.named)('UserRetention', zod_1.z.object({
    climateDays: zod_1.z.number().int().positive().nullable(),
}));
/** What the server sends. Transactional mail - activation, password reset - is not routed and not listed. */
exports.notificationCategory = (0, common_js_1.named)('NotificationCategory', zod_1.z.enum(['alerts', 'tasks', 'plan', 'weekly_timelapse']));
/**
 * A webhook the person owns. Its target and its headers are secrets - they can
 * name an internal host and carry an authorisation header - so they are on the
 * wire for their owner alone, on the account screens that set them, and appear
 * in no shared or public view. Per-alarm bodies and templates are a different
 * thing and live on the alarm rule's `delivery.custom`.
 */
exports.webhookChannel = (0, common_js_1.named)('WebhookChannel', zod_1.z.object({
    url: zod_1.z.string(),
    method: common_js_1.webhookMethod,
    headers: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
}));
/** The chat the install's bot answers in, and which a reply is matched back to. */
exports.telegramChannel = (0, common_js_1.named)('TelegramChannel', zod_1.z.object({
    chatId: zod_1.z.string(),
    linkedAt: (0, common_js_1.instant)(),
}));
/**
 * The addresses. `null` is "not configured", which is also "off": the login
 * address is deliberately not used as a fallback, so that no notification goes
 * anywhere the person did not name.
 */
exports.notificationChannels = (0, common_js_1.named)('NotificationChannels', zod_1.z.object({
    email: zod_1.z.string().nullable(),
    telegram: exports.telegramChannel.nullable(),
    webhook: exports.webhookChannel.nullable(),
}));
/**
 * The what-goes-where grid: every category names the channels it goes out on,
 * and `[]` is "this category is not announced at all".
 */
exports.notificationRouting = (0, common_js_1.named)('NotificationRouting', zod_1.z.record(exports.notificationCategory, zod_1.z.array(common_js_1.notificationChannel)));
/**
 * A wall-clock window in the person's own time zone, so it is minutes from
 * midnight rather than an instant - it has no date and no offset, and therefore
 * neither an ISO string nor an `...At` name. A window that crosses midnight has
 * `fromMinute` greater than `toMinute`. Critical alarms come through it.
 */
exports.quietHours = (0, common_js_1.named)('QuietHours', zod_1.z.object({
    fromMinute: zod_1.z.number().int().min(0).max(1439),
    toMinute: zod_1.z.number().int().min(0).max(1439),
}));
/** One send decision is made from this: mute, then quiet hours, then the routing. */
exports.notificationSettings = (0, common_js_1.named)('NotificationSettings', zod_1.z.object({
    channels: exports.notificationChannels,
    routing: exports.notificationRouting,
    quietHours: exports.quietHours.nullable(),
    mutedUntil: (0, common_js_1.instant)().nullable().describe('Mutes every category, critical alarms included, for this person only.'),
}));
/**
 * The account, as `GET /admin/users` answers it. Its owner is answered `Me`
 * below, and a sign-up `SignupUser`.
 *
 * There is no password hash here and there is no field for one: this contract
 * describes what crosses the wire, a secret never does, and where the hash is
 * kept is the mongoose schema's business. `activationCode` is the one secret of
 * this shape that does cross, and only towards an administrator.
 */
exports.user = (0, common_js_1.named)('User', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    email: zod_1.z.string(),
    isAdmin: zod_1.z.boolean(),
    isActive: zod_1.z.boolean(),
    // Only an account that signed itself up is sent one; an account an
    // administrator created has none. Serialised to an administrator alone,
    // because handing the code over is how such an account is activated.
    activationCode: zod_1.z.string().nullable(),
    handle: zod_1.z.string(),
    bio: zod_1.z.string().nullable(),
    avatarMediaId: (0, common_js_1.id)().nullable(),
    publicProfile: zod_1.z.boolean().describe('Whether /@handle answers with a page at all.'),
    privacy: exports.userPrivacy,
    preferences: exports.userPreferences,
    retention: exports.userRetention,
    notifications: exports.notificationSettings,
    deletionStartedAt: (0, common_js_1.instant)().nullable().describe('Set when deletion begins; it is resumable, so it outlives one request.'),
}));
/**
 * What this install says about Premium, read from its configuration. `enforced`
 * is false in a self-hosted install, where nothing is gated; `extendUrl` and
 * `priceLabel` are what the renewal notice links to and says, which is why this
 * server needs no billing of its own.
 */
exports.premium = (0, common_js_1.named)('Premium', zod_1.z.object({
    enforced: zod_1.z.boolean(),
    extendUrl: zod_1.z.string().nullable(),
    priceLabel: zod_1.z.string().nullable(),
}));
/**
 * `GET /me`: the account as its owner sees it, plus the three facts about the
 * install that the account screens need before they can offer anything - what
 * Premium costs here, the VAPID key a push subscription is made with, and
 * whether a Telegram bot is configured at all.
 */
exports.me = (0, common_js_1.named)('Me', exports.user.omit({ activationCode: true }).extend({
    premium: exports.premium,
    pushPublicKey: zod_1.z.string().nullable().describe('VAPID public key; null until the install configures a key pair.'),
    telegramAvailable: zod_1.z.boolean(),
}));
/**
 * `PATCH /me`. Only what the person owns: the login address is the identity and
 * is not changed here, and `isAdmin`, `isActive` and the activation code are an
 * administrator's.
 */
exports.meUpdate = (0, common_js_1.named)('MeUpdate', exports.user
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
    .partial());
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
const password = () => zod_1.z.string().min(1);
/** `PUT /me/password`. The current one is asked for again, because a stolen session must not be able to keep itself. */
exports.passwordChange = (0, common_js_1.named)('PasswordChange', zod_1.z.object({
    currentPassword: password(),
    newPassword: password(),
}));
/**
 * `POST /users`. A sign-up names its own handle, because it is the only name
 * this account will ever show and inventing one would only have to be corrected.
 */
exports.userCreate = (0, common_js_1.named)('UserCreate', exports.user.pick({ email: true, handle: true }).extend({ password: password() }));
/**
 * What a sign-up is told about the account it just made. Never the activation
 * code: the route is open, so anyone could otherwise activate an address they do
 * not own.
 */
exports.signupUser = (0, common_js_1.named)('SignupUser', exports.user.pick({ id: true, createdAt: true, email: true, handle: true, isActive: true }));
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
exports.userActivation = (0, common_js_1.named)('UserActivation', zod_1.z.object({ activationCode: exports.user.shape.activationCode.unwrap() }));
/**
 * One signed token and the instant it stops working. A duration would be the
 * other way of saying it; the instant is what a client can compare against its
 * own clock without having to remember when it asked.
 */
exports.authToken = (0, common_js_1.named)('AuthToken', zod_1.z.object({
    token: zod_1.z.string(),
    validUntil: (0, common_js_1.instant)(),
}));
/**
 * The three tokens a session is made of: one to call with, one to renew it, one
 * for picture URLs. Handed once to the client that signed in and never answered
 * again - `GET /sessions` names a session by its id, which is not a secret.
 */
exports.sessionTokens = (0, common_js_1.named)('SessionTokens', zod_1.z.object({
    userToken: exports.authToken,
    refreshToken: exports.authToken,
    mediaToken: exports.authToken,
}));
/**
 * A session, as `GET /sessions` lists it and `DELETE /sessions/{id}` revokes
 * it. Everything here is the server's own bookkeeping - there is nothing a
 * client writes - so unlike the resources that carry settings, a session has no
 * configuration to keep apart from its state.
 */
exports.session = (0, common_js_1.named)('Session', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    userId: (0, common_js_1.id)(),
    userAgent: zod_1.z.string().nullable(),
    lastSeenAt: (0, common_js_1.instant)(),
    expiresAt: (0, common_js_1.instant)(),
}));
exports.sessionPage = (0, common_js_1.named)('SessionPage', (0, common_js_1.page)(exports.session));
/** `POST /sessions`. The login identity is the e-mail address; there is no user name to remember. */
exports.sessionCreate = (0, common_js_1.named)('SessionCreate', exports.user.pick({ email: true }).extend({
    password: password(),
    stayLoggedIn: zod_1.z.boolean().optional().describe('Absent means a session that ends with the browser.'),
}));
/**
 * Who the session belongs to, as the sign-in routes report it. Enough to draw
 * the shell - the rest of the account is `GET /me` - and `isDemo` says there is
 * no account behind it at all.
 */
exports.sessionUser = (0, common_js_1.named)('SessionUser', zod_1.z.object({
    id: (0, common_js_1.id)(),
    handle: zod_1.z.string(),
    isAdmin: zod_1.z.boolean(),
    isDemo: zod_1.z.boolean(),
}));
/** What `POST /sessions` and `POST /sessions/demo` answer. The id is how this session revokes itself. */
exports.sessionResult = (0, common_js_1.named)('SessionResult', exports.sessionTokens.extend({
    sessionId: (0, common_js_1.id)(),
    user: exports.sessionUser,
}));
/**
 * `POST /sessions/demo`: the tour of the demo objects, which needs no
 * credentials and therefore carries nothing. The empty body is named all the
 * same, so that the contract says "this route takes no arguments" rather than
 * leaving a client to guess what it forgot to send.
 */
exports.demoSessionCreate = (0, common_js_1.named)('DemoSessionCreate', zod_1.z.object({}));
/**
 * `POST /sessions/refresh`. The refresh token is spent and a fresh
 * `SessionTokens` triple comes back - not a `SessionResult`: the session and the
 * person behind it are the ones the client already knows.
 */
exports.sessionRefresh = (0, common_js_1.named)('SessionRefresh', zod_1.z.object({ refreshToken: zod_1.z.string() }));
/** `POST /sessions/automation`. The token is the install's own, out of its configuration. */
exports.automationSessionCreate = (0, common_js_1.named)('AutomationSessionCreate', zod_1.z.object({ token: zod_1.z.string() }));
/**
 * What the automation token buys: a short-lived administrator session and
 * nothing to renew it with, so a caller that needs longer asks again.
 */
exports.automationSession = (0, common_js_1.named)('AutomationSession', exports.sessionTokens.pick({ userToken: true }));
/**
 * `POST /password-resets`. Answered 202 with no body, the same way whether or
 * not the address has an account: what comes back must not tell a stranger who
 * is registered here.
 */
exports.passwordResetCreate = (0, common_js_1.named)('PasswordResetCreate', exports.user.pick({ email: true }));
/**
 * `POST /password-resets/{token}/redemptions`. The token is in the path, because
 * it is what was mailed. Answers 204 and no session, so that a reset link read
 * by somebody else is one more thing to sign in with rather than a way in.
 */
exports.passwordResetRedemption = (0, common_js_1.named)('PasswordResetRedemption', zod_1.z.object({ password: password() }));
/*
 * A pending reset has no shape here. Nothing of it is ever answered - the stored
 * record is the hashed half of what was mailed - and this contract describes
 * what crosses the wire, so the document's own shape belongs to the mongoose
 * schema instead.
 */
/** The Web Push keys the browser hands out with its endpoint. */
exports.pushSubscriptionKeys = (0, common_js_1.named)('PushSubscriptionKeys', zod_1.z.object({
    p256dh: zod_1.z.string(),
    auth: zod_1.z.string(),
}));
exports.pushSubscription = (0, common_js_1.named)('PushSubscription', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    userId: (0, common_js_1.id)(),
    endpoint: zod_1.z.string(),
    keys: exports.pushSubscriptionKeys,
    userAgent: zod_1.z.string().nullable().describe('Which browser this subscription is, so that a person can tell two apart.'),
}));
/** `POST /me/push-subscriptions`. The endpoint identifies it, so re-subscribing the same browser is an upsert. */
exports.pushSubscriptionCreate = (0, common_js_1.named)('PushSubscriptionCreate', exports.pushSubscription.pick({ endpoint: true, keys: true }));
/**
 * `POST /me/telegram-link`: the one-time link that connects a chat to this
 * account. The request carries nothing - the session says whose account it is -
 * and this is the answer. Opening the link starts the install's bot, which is
 * what produces the `chatId` in `NotificationChannels`.
 *
 * The URL carries the link secret, so it is answered to the person who asked for
 * it and to nobody else; whoever opens it gets the chat bound to this account.
 */
exports.telegramLink = (0, common_js_1.named)('TelegramLink', zod_1.z.object({
    url: zod_1.z.string(),
    validUntil: (0, common_js_1.instant)(),
}));
/**
 * What was sent to whom. It is what keeps a due task from being announced
 * twice, and what maps a Telegram reply back to the thing it answers - hence
 * `externalMessageId`, which is the id the channel gave the message and is null
 * for a channel that gives none.
 */
exports.notificationSubjectType = (0, common_js_1.named)('NotificationSubjectType', zod_1.z.enum(['alert', 'task', 'plan', 'media']));
exports.notificationLogEntry = (0, common_js_1.named)('NotificationLogEntry', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    userId: (0, common_js_1.id)(),
    channel: common_js_1.notificationChannel,
    category: exports.notificationCategory,
    subject: (0, common_js_1.subjectRef)(exports.notificationSubjectType),
    externalMessageId: zod_1.z.string().nullable(),
    sentAt: (0, common_js_1.instant)(),
    expiresAt: (0, common_js_1.instant)(),
}));
exports.exportStatus = (0, common_js_1.named)('ExportStatus', zod_1.z.enum(['queued', 'running', 'ready', 'failed']));
/**
 * `GET /me/export`. Zipping a person's grows, their CSVs and their photos does
 * not finish inside a request, so the route answers this and it is polled until
 * `downloadUrl` is there.
 */
exports.userExport = (0, common_js_1.named)('UserExport', zod_1.z.object({
    id: (0, common_js_1.id)(),
    createdAt: (0, common_js_1.instant)(),
    status: exports.exportStatus,
    startedAt: (0, common_js_1.instant)().nullable(),
    endedAt: (0, common_js_1.instant)().nullable(),
    downloadUrl: zod_1.z.string().nullable(),
    validUntil: (0, common_js_1.instant)().nullable().describe('When the finished file is swept; null while it is still being made.'),
    detail: zod_1.z.string().nullable().describe('Why it failed; null otherwise.'),
}));
/**
 * `GET /admin/users`. An administrator is the one other reader of an address and
 * the only reader of an activation code, which is all of `User` as it stands -
 * so there is no narrower admin shape to name, and the list is a page of users.
 */
exports.adminUserPage = (0, common_js_1.named)('AdminUserPage', (0, common_js_1.page)(exports.user));
/**
 * `POST /admin/users`. A sign-up plus the two flags only an administrator may
 * set; both are optional, and an account made this way is active at once and has
 * no activation code, because whoever created it can hand the password over.
 */
exports.adminUserCreate = (0, common_js_1.named)('AdminUserCreate', exports.userCreate.extend(exports.user.pick({ isAdmin: true, isActive: true }).partial().shape));
/**
 * `PATCH /admin/users/{id}`: the same fields, each only if it changes. `password`
 * among them, which is how an administrator resets one for somebody who cannot
 * receive the mail.
 */
exports.adminUserUpdate = (0, common_js_1.named)('AdminUserUpdate', exports.adminUserCreate.partial());
