import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { compare, hash } from 'bcrypt';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AdminUserCreate, AdminUserUpdate, Me, MeUpdate, NotificationSettings, User } from '@fg2/shared-types/v1';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { conflict, notFound } from '@common/v1/problem';
import { MODEL_V1 } from '@database/models';
import { StoredNotificationSettings, StoredUser } from '@database/schemas/v1/users.schema';
import { authConfig, notificationsConfig, premiumConfig } from '@config/configuration';
import { logger } from '@utils/logger';

/**
 * The one reader and writer of `users`.
 *
 * Everything an account is made of sits here rather than in the routes, because
 * three of them ask for the same things: signing in reads the hash, the account
 * screens read and write the person's own row, and an administrator does both
 * for somebody else. What differs between them is who may ask, which the routes
 * decide, and how much of the row is serialised, which is the pair of
 * serialisers below.
 *
 * A password is hashed here and nowhere else, and the hash is `select: false` on
 * the schema, so a read that did not ask for it cannot leak it by accident.
 */

const PASSWORD_ROUNDS = 10;

/** What is compared to sign somebody in; nothing else ever asks for the hash. */
const WITH_PASSWORD = '+passwordHash';

@Injectable()
export class AccountsService implements OnModuleInit {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
    @Inject(premiumConfig.KEY) private readonly premium: ConfigType<typeof premiumConfig>,
    @Inject(notificationsConfig.KEY) private readonly notifications: ConfigType<typeof notificationsConfig>,
  ) {}

  /**
   * The account the environment names is created on first start and has its
   * password reset to the configured one on every start, so an operator who has
   * lost it only has to change the setting and restart.
   */
  public async onModuleInit(): Promise<void> {
    const { adminUsername, adminPassword } = this.auth;

    try {
      const passwordHash = await hash(adminPassword, PASSWORD_ROUNDS);
      const existing = await this.users.findOne({ email: adminUsername }, { id: 1 }).lean();

      if (existing) {
        await this.users.updateOne({ id: existing.id }, { $set: { passwordHash, isAdmin: true, isActive: true } });
        return;
      }

      logger.info(`Creating the configured admin account ${adminUsername}`);
      await this.store({ email: adminUsername, handle: await this.freeHandle(adminUsername), passwordHash, isAdmin: true, isActive: true });
    } catch (error) {
      // Not fatal: the rest of the API still works, and the readiness probe
      // reports the account as missing until this succeeds.
      logger.error(`Could not bootstrap the admin account: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  public async byId(id: string): Promise<StoredUser | null> {
    return this.users.findOne({ id }).lean();
  }

  /** By the login identity. Never answers whether an address is registered to anyone but the caller of this. */
  public async byEmail(email: string): Promise<StoredUser | null> {
    return this.users.findOne({ email }).lean();
  }

  /** The same, as a demand: a route that names an account it cannot find has been given a wrong id. */
  public async require(id: string): Promise<StoredUser> {
    const user = await this.byId(id);
    if (!user) throw notFound('user_not_found', 'There is no account with that id.');

    return user;
  }

  /**
   * The sign-in lookup. It answers the same nothing for an unknown address and
   * for a wrong password, so that what comes back never says who has an account
   * here.
   *
   * An account whose deletion has begun answers that same nothing: the run takes
   * a while and can be resumed across a restart, and a session opened in the
   * middle of one would write into the half that is still standing.
   */
  public async verify(email: string, password: string): Promise<StoredUser | null> {
    const user = await this.users.findOne({ email, deletionStartedAt: null }).select(WITH_PASSWORD).lean();
    if (!user) return null;

    return (await compare(password, user.passwordHash)) ? user : null;
  }

  public async list(query: PageQuery): Promise<CursorPage<User>> {
    const limit = pageLimit(query.limit);
    const rows = await this.users.find(afterCursor('createdAt', query.cursor)).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean();

    const page = pageOf(rows, limit, row => ({ at: row.createdAt, id: row.id }));
    return { items: page.items.map(row => this.serialise(row)), nextCursor: page.nextCursor };
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  /**
   * A sign-up. An account that signs itself up is sent an activation code when
   * the install asks for one, and is active at once when it does not - so the
   * code exists exactly when there is a mail carrying it.
   */
  public async signUp(email: string, handle: string, password: string): Promise<StoredUser> {
    const activationCode = this.auth.requireActivation ? randomUUID() : null;

    return this.create({ email, handle, password, isActive: activationCode === null, activationCode });
  }

  /**
   * An account an administrator makes. It is active at once and has no
   * activation code, because whoever created it can hand the password over.
   */
  public async createAsAdmin(body: AdminUserCreate): Promise<StoredUser> {
    return this.create({
      email: body.email,
      handle: body.handle,
      password: body.password,
      isAdmin: body.isAdmin ?? false,
      isActive: body.isActive ?? true,
      activationCode: null,
    });
  }

  /** What the account screens own. The login address is the identity and is not changed here. */
  public async updateOwn(id: string, body: MeUpdate): Promise<StoredUser> {
    if (body.handle !== undefined) await this.claimHandle(body.handle, id);

    const { notifications, ...rest } = body;
    const changes: Partial<StoredUser> = { ...rest };
    if (notifications !== undefined) changes.notifications = stored(notifications);

    return this.apply(id, changes);
  }

  /** The same fields an administrator may create, each only if it changes. */
  public async updateAsAdmin(id: string, body: AdminUserUpdate): Promise<StoredUser> {
    const { password, ...rest } = body;

    if (rest.email !== undefined) await this.claimEmail(rest.email, id);
    if (rest.handle !== undefined) await this.claimHandle(rest.handle, id);

    const changes: Partial<StoredUser> = { ...rest };
    if (password !== undefined) changes.passwordHash = await hash(password, PASSWORD_ROUNDS);

    return this.apply(id, changes);
  }

  public async setPassword(id: string, password: string): Promise<void> {
    await this.apply(id, { passwordHash: await hash(password, PASSWORD_ROUNDS) });
  }

  /**
   * The code is the whole proof, so it is looked up on its own and retired with
   * the account it activated: a code that has been spent activates nothing a
   * second time.
   */
  public async activate(activationCode: string): Promise<void> {
    const activated = await this.users.updateOne({ activationCode }, { $set: { isActive: true, activationCode: null } });
    if (activated.matchedCount === 0) throw notFound('activation_code_unknown', 'That activation code belongs to no account.');
  }

  /**
   * The first write of a deletion, and the one the rest of it hangs off: there
   * are no transactions here, so a single-document update is the only thing that
   * either happened or did not. Filtered on the field still being empty, so a
   * run picked up again after a restart keeps the moment it really began rather
   * than moving it forward on every attempt.
   */
  public async beginDeletion(id: string): Promise<void> {
    await this.users.updateOne({ id, deletionStartedAt: null }, { $set: { deletionStartedAt: new Date() } });
  }

  /** The accounts whose deletion began and never finished, which is what a boot sweep has to pick up. */
  public async deletionsUnfinished(): Promise<string[]> {
    const rows = await this.users.find({ deletionStartedAt: { $ne: null } }, { id: 1 }).lean();
    return rows.map(row => row.id);
  }

  /**
   * The row itself. It is deleted last of everything an account owns, because
   * while it is there the marker above names a run that can be finished, and
   * once it is gone nothing left behind can be found again.
   */
  public async remove(id: string): Promise<void> {
    const removed = await this.users.deleteOne({ id });
    if (removed.deletedCount === 0) throw notFound('user_not_found', 'There is no account with that id.');
  }

  // ---------------------------------------------------------------------------
  // Serialising
  // ---------------------------------------------------------------------------

  /**
   * The account as an administrator reads it. The address and the activation
   * code are on the wire for an administrator and for the account itself, and
   * for nobody else; the hash has no field at all.
   */
  public serialise(user: StoredUser): User {
    return {
      id: user.id,
      createdAt: user.createdAt.toISOString(),
      email: user.email,
      isAdmin: user.isAdmin,
      isActive: user.isActive,
      activationCode: user.activationCode,
      handle: user.handle,
      bio: user.bio,
      avatarMediaId: user.avatarMediaId,
      publicProfile: user.publicProfile,
      privacy: { hideWeights: user.privacy.hideWeights, hideCounts: user.privacy.hideCounts },
      preferences: { units: { ...user.preferences.units }, locale: user.preferences.locale, timezone: user.preferences.timezone },
      retention: { climateDays: user.retention.climateDays },
      notifications: {
        channels: {
          email: user.notifications.channels.email,
          telegram: user.notifications.channels.telegram && {
            chatId: user.notifications.channels.telegram.chatId,
            linkedAt: user.notifications.channels.telegram.linkedAt.toISOString(),
          },
          webhook: user.notifications.channels.webhook && { ...user.notifications.channels.webhook },
        },
        routing: { ...user.notifications.routing },
        quietHours: user.notifications.quietHours && { ...user.notifications.quietHours },
        mutedUntil: user.notifications.mutedUntil?.toISOString() ?? null,
      },
      deletionStartedAt: user.deletionStartedAt?.toISOString() ?? null,
    };
  }

  /**
   * The account as its owner reads it: without the activation code, which is
   * only ever handed to an administrator, and with the three facts about this
   * install that the account screens need before they can offer anything.
   */
  public serialiseMe(user: StoredUser): Me {
    const { activationCode: _code, ...rest } = this.serialise(user);

    return {
      ...rest,
      premium: {
        enforced: this.premium.enforced,
        extendUrl: this.premium.extendUrl || null,
        priceLabel: this.premium.priceLabel || null,
      },
      pushPublicKey: this.notifications.pushPublicKey,
      telegramAvailable: this.notifications.telegramBotToken !== null,
    };
  }

  // ---------------------------------------------------------------------------
  // The shared half
  // ---------------------------------------------------------------------------

  private async create(account: {
    email: string;
    handle: string;
    password: string;
    isAdmin?: boolean;
    isActive: boolean;
    activationCode: string | null;
  }): Promise<StoredUser> {
    await this.claimEmail(account.email, null);
    await this.claimHandle(account.handle, null);

    return this.store({
      email: account.email,
      handle: account.handle,
      passwordHash: await hash(account.password, PASSWORD_ROUNDS),
      isAdmin: account.isAdmin ?? false,
      isActive: account.isActive,
      activationCode: account.activationCode,
    });
  }

  /** Everything not named here is the schema's default, which is where a new field's "none" is decided. */
  private async store(account: Partial<StoredUser> & { email: string; handle: string; passwordHash: string }): Promise<StoredUser> {
    const created = await this.users.create({ ...account, id: randomUUID() });
    return created.toObject<StoredUser>();
  }

  private async apply(id: string, changes: Partial<StoredUser>): Promise<StoredUser> {
    // A partial update that names no field is the account as it stands, and is
    // answered as such: an empty `$set` is a write the database refuses.
    if (Object.keys(changes).length === 0) return this.require(id);

    const updated = await this.users.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean();
    if (!updated) throw notFound('user_not_found', 'There is no account with that id.');

    return updated;
  }

  /**
   * The two unique names, checked before they are written. The indexes are what
   * make them unique; this is what makes a collision a sentence naming the field
   * rather than a driver error.
   */
  private async claimEmail(email: string, ownedBy: string | null): Promise<void> {
    const taken = await this.users.findOne({ email }, { id: 1 }).lean();
    if (taken && taken.id !== ownedBy) throw conflict('email_taken', 'There is already an account with that address.');
  }

  private async claimHandle(handle: string, ownedBy: string | null): Promise<void> {
    const taken = await this.users.findOne({ handle }, { id: 1 }).lean();
    if (taken && taken.id !== ownedBy) throw conflict('handle_taken', 'That handle is taken.');
  }

  /**
   * A handle for the account the install seeds, which names an address and not a
   * handle. The local part is the obvious reading of what the operator meant;
   * where that is taken or unusable, a suffix keeps the start-up from being the
   * thing that fails.
   */
  private async freeHandle(email: string): Promise<string> {
    const wanted =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') || 'admin';
    const taken = await this.users.findOne({ handle: wanted }, { id: 1 }).lean();

    return taken ? `${wanted}-${randomUUID().slice(0, 8)}` : wanted;
  }
}

/**
 * The one difference between the notification settings on the wire and the ones
 * in the database: an instant is an ISO string out there and a BSON date in
 * here. Everything else of them is the contract's shape unchanged, which is why
 * only the two instants are named.
 */
const stored = (settings: NotificationSettings): StoredNotificationSettings => ({
  channels: {
    email: settings.channels.email,
    telegram: settings.channels.telegram && { chatId: settings.channels.telegram.chatId, linkedAt: new Date(settings.channels.telegram.linkedAt) },
    webhook: settings.channels.webhook,
  },
  routing: settings.routing,
  quietHours: settings.quietHours,
  mutedUntil: settings.mutedUntil === null ? null : new Date(settings.mutedUntil),
});
