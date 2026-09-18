import { mongo } from 'mongoose';
import { notificationCategory } from '@fg2/shared-types/v1-schemas';
import { LEGACY, LegacyUser, createdAtOf, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * The accounts, renamed into the new vocabulary.
 *
 * `user_id` has no unique index today, and every other collection points at it,
 * so a duplicate is not a document to reject - it is two accounts sharing the
 * devices, grows and pictures of one id, and nothing here can say which of them
 * owns what. That aborts the run, before a single collection has been renamed
 * aside, with both documents named in the failure.
 *
 * Two fields the old accounts have no answer for:
 *
 * - **`handle`**, which is unique and the only name others ever see. Derived
 *   from the local part of the address, so it is recognisable to its owner, and
 *   numbered where two addresses reduce to the same word. Nobody's address is
 *   published by this: the handle only becomes visible when a grow is made
 *   public, and every migrated account keeps `publicProfile: false`.
 * - **`notifications.channels.email`**, which stays `null` rather than being
 *   filled with the sign-in address. Every channel is off until it is
 *   configured; filling this one in would start sending mail to people who never
 *   asked for it.
 */

const DEFAULT_ROUTING = Object.fromEntries(notificationCategory.options.map(category => [category, [] as string[]]));

export const users: MigrationStep = {
  name: '002-users',

  async run(context: MigrationContext): Promise<void> {
    const source = await context.source(LEGACY.users);
    await assertOneDocumentPerUserId(source);

    await context.renameAside(LEGACY.users);
    const legacy = await context.source(LEGACY.users);
    const handles = new Handles();

    for await (const user of legacy.find<LegacyUser>({}).sort({ _id: 1 })) {
      context.count('users.read');

      const id = textOf(user.user_id);
      const email = textOf(user.username);
      const passwordHash = textOf(user.password);

      if (!id || !email || !passwordHash) {
        context.reject({
          source: LEGACY.users,
          id: id ?? String(user._id),
          reason: 'an account without an id, an address or a password cannot sign in and has no owner to be',
          dropped: true,
          detail: null,
        });
        continue;
      }

      await context.write('users', {
        id,
        createdAt: createdAtOf(user),
        email,
        passwordHash,
        isAdmin: user.is_admin === true,
        isActive: user.is_active === true,
        activationCode: textOf(user.activation_code),
        handle: handles.forEmail(email),
        bio: null,
        avatarMediaId: null,
        publicProfile: false,
        privacy: { hideWeights: false, hideCounts: false },
        preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'UTC' },
        retention: { climateDays: null },
        notifications: {
          channels: { email: null, telegram: null, webhook: null },
          routing: { ...DEFAULT_ROUTING },
          quietHours: null,
          mutedUntil: null,
        },
        deletionStartedAt: null,
      });
    }
  },
};

const assertOneDocumentPerUserId = async (source: mongo.Collection): Promise<void> => {
  const duplicates = await source
    .aggregate<{ _id: string; ids: string[] }>([
      { $group: { _id: '$user_id', count: { $sum: 1 }, ids: { $push: { $toString: '$_id' } } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length === 0) return;

  const report = duplicates.map(duplicate => `${duplicate._id} (${duplicate.ids.join(', ')})`).join('; ');
  throw new Error(`Two or more accounts share one user_id, so nothing can say who owns their devices and grows: ${report}`);
};

/** Unique handles, in the order the accounts were created, so the oldest account keeps the plain one. */
class Handles {
  private readonly taken = new Set<string>();

  public forEmail(email: string): string {
    const base =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '')
        .slice(0, 24) || 'grower';

    let handle = base;
    for (let suffix = 2; this.taken.has(handle); suffix++) handle = `${base}${suffix}`;

    this.taken.add(handle);
    return handle;
  }
}
