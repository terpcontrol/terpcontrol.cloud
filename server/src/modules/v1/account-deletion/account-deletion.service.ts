import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { conflict } from '@common/v1/problem';
import { deleteStoredImages } from '@database/image-store';
import { MODEL_V1 } from '@database/models';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { ChartViewDocument } from '@database/schemas/v1/chart-views.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { FollowDocument } from '@database/schemas/v1/follows.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { InviteDocument } from '@database/schemas/v1/invites.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { StoredNotificationLogEntry } from '@database/schemas/v1/notification-log.schema';
import { StoredPlanTemplate } from '@database/schemas/v1/plan-templates.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { StoredPushSubscription } from '@database/schemas/v1/push-subscriptions.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SchemeDocument } from '@database/schemas/v1/schemes.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { authConfig } from '@config/configuration';
import { logger } from '@utils/logger';
import { AccountsService } from '../account/accounts.service';
import { PasswordResetService } from '../account/password-reset.service';
import { DevicesService } from '../device/devices.service';
import { SessionsService } from '../sessions/sessions.service';

/**
 * Deleting an account, and everything the account is.
 *
 * It is written once and both routes take it - the account deleting itself and
 * an administrator deleting somebody else - because a second, shallower path
 * would be the weaker of the two, and which of them is weaker would depend on
 * which was last remembered.
 *
 * There are no transactions here: the server talks to a single MongoDB with no
 * replica set, so nothing spanning two documents is atomic. The run is
 * idempotent and resumable instead. The account is taken off the internet
 * first, in writes that need nothing to have happened before them;
 * `users.deletionStartedAt` is stamped next, in the one write that either
 * happened or did not; and the row itself is deleted last - so any moment in
 * between is a safe state to stop at, and the marked row is the record of what
 * is left to do. Every step derives its ids from rows that are still there and
 * deletes children before their parent, which is what makes a second pass
 * finish the work rather than trip over it.
 *
 * The sessions are ended before anything else and nothing re-opens one, because
 * every authenticated request resolves its caller against the session row: a
 * deleted account stops being able to ask for anything the moment the run
 * begins, rather than for as long as the token it was holding has left. What
 * remains deliberate is that the run is inline - the caller waits for it, and a
 * very large account makes a long request. Resumability is the net under a
 * crash, not a queue.
 *
 * What it must not take is as much of the point as what it takes. A row is this
 * account's when nothing else is a parent of it: a diary line, a picture or an
 * alert that happened in one of these spaces but stands on somebody else's
 * grow, device or camera belongs to that timeline and stays, which is the same
 * rule the daily sweep for unreachable rows decides by.
 *
 * What is deliberately not deleted: the device rows and their broker
 * credentials, because the hardware is still out there and the record says an
 * unclaimed device stays claimable; and the climate series, because a released
 * device keeps the readings it took and dropping them is the retention
 * mechanism's decision rather than a side effect of this one.
 */

const RESUME_START_DELAY_MS = 5_000;
const RESUME_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How many pictures are deleted at a time. The media schema frees the bytes
 * behind a delete by first reading every id the filter matches into memory, and
 * a camera that took a still every thirty seconds for three weeks has sixty
 * thousand of them.
 */
const MEDIA_BATCH = 500;

/** What one run removed, for the line it writes when it is done. */
interface Tally {
  spaces: number;
  grows: number;
  cameras: number;
  devices: number;
  entries: number;
  media: number;
}

@Injectable()
export class AccountDeletionService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.chartView) private readonly chartViews: Model<ChartViewDocument>,
    @InjectModel(MODEL_V1.device) private readonly deviceRows: Model<StoredDevice>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.follow) private readonly follows: Model<FollowDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.invite) private readonly invites: Model<InviteDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.notificationLogEntry) private readonly notifications: Model<StoredNotificationLogEntry>,
    @InjectModel(MODEL_V1.planTemplate) private readonly planTemplates: Model<StoredPlanTemplate>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.pushSubscription) private readonly pushSubscriptions: Model<StoredPushSubscription>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.scheme) private readonly schemes: Model<SchemeDocument>,
    @InjectModel(MODEL_V1.shareLink) private readonly shareLinks: Model<ShareLinkDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly resets: PasswordResetService,
    private readonly devices: DevicesService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  /**
   * A crashed run is picked up shortly after the server is serving rather than
   * before it: unlike a migration this recurs on every boot until it is done,
   * its cost is one account's pictures, and the account it concerns is signed
   * out and unreachable from the first step onwards either way.
   */
  public onModuleInit(): void {
    this.work.schedule('The resume of unfinished account deletions', () => this.resumePeriodically(), RESUME_START_DELAY_MS);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------

  public async deleteAccount(userId: string): Promise<void> {
    await this.erase(await this.accounts.require(userId));
  }

  /**
   * The accounts a run left half-deleted, finished with the same steps that
   * began them. One account that cannot be finished is logged and left for the
   * next pass: it is a reason to look at that account, never a reason for every
   * other half-deleted account to stay half-deleted behind it.
   */
  public async resumeUnfinished(): Promise<number> {
    const pending = await this.accounts.deletionsUnfinished();
    if (pending.length === 0) return 0;

    logger.info(`Resuming ${pending.length} account deletion(s) that did not finish`);
    for (const id of pending) {
      try {
        const user = await this.accounts.byId(id);
        if (user) await this.erase(user);
      } catch (e) {
        logger.error(`Could not finish the deletion of account ${id}: ${e}`);
      }
    }

    return pending.length;
  }

  private async resumePeriodically(): Promise<void> {
    try {
      await this.resumeUnfinished();
    } catch (e) {
      logger.error(`Resuming unfinished account deletions failed: ${e}`);
    } finally {
      // Each pass arms the next, so a server on its way down has to refuse it
      // rather than only cancel the timer that happens to be pending.
      this.work.schedule('The resume of unfinished account deletions', () => this.resumePeriodically(), RESUME_INTERVAL_MS);
    }
  }

  /**
   * The whole run, in the order that makes any prefix of it safe: the cheap
   * writes that stop the account being reachable, which need nothing to have
   * happened first and so come before the marker itself; then the marker; then
   * the objects the account owns, children before parents; then what it left on
   * other people's rows; and the row itself last.
   *
   * The one account this refuses is refused here rather than at the routes,
   * because the invariant belongs to the row: a marked row is picked up by the
   * boot sweep, which no route is between.
   */
  private async erase(user: StoredUser): Promise<void> {
    const userId = user.id;
    const tally: Tally = { spaces: 0, grows: 0, cameras: 0, devices: 0, entries: 0, media: 0 };

    // The account the environment names is looked up by address and written back
    // on every boot, so deleting it either resurrects it in the middle of the run
    // or re-creates it under a new id and strands everything this one owned.
    if (user.email === this.auth.adminUsername) {
      throw conflict('admin_account_kept', 'That is the account this install is configured with, and it is not deleted from here.');
    }

    await this.stopBeingReachable(userId);
    await this.accounts.beginDeletion(userId);

    await this.eraseCameras(userId, tally);
    await this.unclaimDevices(userId, tally);
    await this.eraseGrows(userId, tally);
    await this.eraseSpaces(userId, tally);
    await this.eraseOwnRowsElsewhere(user, tally);
    await this.handOverWhatIsLeftElsewhere(userId);
    await this.forgetTheAuthor(userId);

    await this.accounts.remove(userId);

    logger.info(
      `Deleted account ${userId}: ${tally.spaces} space(s), ${tally.grows} grow(s), ${tally.cameras} camera(s), ` +
        `${tally.entries} diary entr(ies) and ${tally.media} picture(s); ${tally.devices} device(s) unclaimed`,
    );
  }

  /**
   * The writes that cost nothing and take the account off the internet at once,
   * so that the length of the run is not the length of time a deleted person's
   * diary goes on being served. They run before the marker rather than after
   * it: every one of them is idempotent and needs nothing the marker says, and
   * a crash in between would otherwise leave a public diary served and a
   * signed-in client writing until the next boot.
   *
   * A public grow is made private here rather than when its turn comes, because
   * the public page resolves a grow by its address and its visibility and never
   * looks at who owns it - and making every public read ask after the owner
   * would be a query on every page view for ever, to answer something one write
   * here settles.
   */
  private async stopBeingReachable(userId: string): Promise<void> {
    await this.sessions.revokeAllOf(userId);
    await this.resets.retire(userId);
    await this.grows.updateMany({ ownerId: userId }, { $set: { visibility: 'private' } });
    await this.shareLinks.deleteMany({ createdBy: userId });
  }

  /**
   * The cameras, really gone rather than buried. Giving one device up leaves
   * the row behind for the pictures taken under it, because the person is still
   * there to be shown them and may claim the device back; an account that is
   * being deleted is neither, and a row naming an owner who no longer exists is
   * reachable from nothing. They go before the devices only so that what
   * releasing the claim would bury has already gone.
   */
  private async eraseCameras(userId: string, tally: Tally): Promise<void> {
    const cameraIds = await this.cameras.distinct('id', { ownerId: userId });

    if (cameraIds.length > 0) {
      tally.media += await this.purgeMedia({ cameraId: { $in: cameraIds } });
      await this.alerts.deleteMany({ cameraId: { $in: cameraIds } });
      // A camera can be the whole subject of a diary line, and a line naming
      // nothing else is outside the sweep that collects what nothing can reach.
      tally.entries += await this.deleteEntries({ cameraId: { $in: cameraIds } });
    }

    tally.cameras += (await this.cameras.deleteMany({ ownerId: userId })).deletedCount ?? 0;
  }

  /**
   * The devices are not deleted: the hardware is still out there and stays
   * claimable, which is the whole of what the next owner needs - a claim asks
   * after `ownerId` and nothing else.
   *
   * Their diary lines do go, which is where this parts company with giving one
   * device up. A line on a grow is something a person wrote and it belongs to
   * whoever's diary it stands in; a line on a device is what the hardware
   * reported, and the next person to claim it is owed none of the last one's.
   */
  private async unclaimDevices(userId: string, tally: Tally): Promise<void> {
    const deviceIds = await this.deviceRows.distinct('id', { ownerId: userId });
    if (deviceIds.length === 0) return;

    // Before the rules go with the claim: an alert names the rule it came from,
    // and that name is the only way back to it.
    await this.alerts.deleteMany({ deviceId: { $in: deviceIds } });
    tally.entries += await this.deleteEntries({ deviceId: { $in: deviceIds } });

    for (const id of deviceIds) await this.devices.releaseClaim(id);
    tally.devices += deviceIds.length;
  }

  private async eraseGrows(userId: string, tally: Tally): Promise<void> {
    const grows = await this.grows.find({ ownerId: userId }, { id: 1, coverMediaId: 1, filmMediaId: 1 }).lean();
    const growIds = grows.map(grow => grow.id);

    if (growIds.length > 0) {
      // A rendered film names the camera it was drawn from rather than the grow
      // it belongs to, so the grow is the only thing that knows about it.
      const named = grows.flatMap(grow => [grow.coverMediaId, grow.filmMediaId]).filter((id): id is string => id !== null);

      tally.media += await this.purgeMedia({ growId: { $in: growIds } });
      // Named pictures only where the account is the one who put them there:
      // a grow's cover and its film are set to whatever the request named, and
      // nothing checks whose picture that is, so a grow can point at somebody
      // else's. What the account's own cameras took has already gone with them.
      if (named.length > 0) tally.media += await this.purgeMedia({ id: { $in: named }, uploadedBy: userId });

      tally.entries += await this.deleteEntries({ growId: { $in: growIds } });
      // Somebody else's rows, and nothing else in the server ever takes them.
      await this.follows.deleteMany({ growId: { $in: growIds } });
      await this.reminders.deleteMany({ 'subject.type': 'grow', 'subject.id': { $in: growIds } });
      await this.shareLinks.deleteMany({ 'subject.type': 'grow', 'subject.id': { $in: growIds } });
      await this.plants.deleteMany({ growId: { $in: growIds } });
    }

    tally.grows += (await this.grows.deleteMany({ ownerId: userId })).deletedCount ?? 0;
  }

  /**
   * The spaces really are deleted, members and all, which is where this parts
   * company with somebody ending one space of their own: that keeps the row so
   * the history naming it still reads, and refuses while anything stands in the
   * place. Neither survives the account the place belonged to.
   *
   * Rooms and the spaces grouped under them go in the same statement. The
   * ordering between them only ever existed to satisfy that refusal.
   */
  private async eraseSpaces(userId: string, tally: Tally): Promise<void> {
    const spaceIds = await this.spaces.distinct('id', { ownerId: userId });

    if (spaceIds.length > 0) {
      // Only what the space is the whole of. A picture, a line or an alert that
      // happened in this tent but names a grow, a device or a camera as well
      // stands on that timeline too, and that timeline may be somebody else's -
      // so the space going is not the end of it. It is the same reachability the
      // daily sweep decides by, which is what collects such a row later if every
      // one of its parents has gone as well.
      tally.media += await this.purgeMedia({ spaceId: { $in: spaceIds }, cameraId: null, growId: null });
      tally.entries += await this.deleteEntries({ spaceId: { $in: spaceIds }, growId: null, deviceId: null, cameraId: null });
      await this.memberships.deleteMany({ spaceId: { $in: spaceIds } });
      await this.invites.deleteMany({ spaceId: { $in: spaceIds } });
      await this.shareLinks.deleteMany({ 'subject.type': 'space', 'subject.id': { $in: spaceIds } });
      await this.reminders.deleteMany({ 'subject.type': 'space', 'subject.id': { $in: spaceIds } });
      await this.alerts.deleteMany({ spaceId: { $in: spaceIds }, deviceId: null, cameraId: null });

      // What other people had standing in these places. Their things are not
      // this account's to delete, so they are only taken out of the room: their
      // owner sees them unplaced, which is what has happened to them.
      await this.deviceRows.updateMany({ spaceId: { $in: spaceIds } }, { $set: { spaceId: null } });
      await this.cameras.updateMany({ spaceId: { $in: spaceIds } }, { $set: { spaceId: null } });
      // A placement is ended rather than emptied: `endedAt` is already what the
      // model means by "no longer standing there", while a placement with no
      // space and no end reads as standing in nothing right now, which is false.
      // The grow keeps its own history of having stood here until today.
      await this.grows.updateMany(
        { 'placements.spaceId': { $in: spaceIds } },
        { $set: { 'placements.$[p].endedAt': new Date() } },
        { arrayFilters: [{ 'p.spaceId': { $in: spaceIds }, 'p.endedAt': null }] },
      );
    }

    tally.spaces += (await this.spaces.deleteMany({ ownerId: userId })).deletedCount ?? 0;
  }

  /**
   * What the account owns in collections that hang off nothing else, and the two
   * kinds of row that name only their author - a line about nothing in
   * particular and a picture that was never put anywhere. Nothing would ever
   * collect either: the sweep for what cannot be reached only considers a line
   * that names a grow, a space or a device.
   */
  private async eraseOwnRowsElsewhere(user: StoredUser, tally: Tally): Promise<void> {
    const userId = user.id;

    await this.chartViews.deleteMany({ ownerId: userId });
    await this.schemes.deleteMany({ ownerId: userId });
    await this.planTemplates.deleteMany({ ownerId: userId });
    await this.pushSubscriptions.deleteMany({ userId });
    await this.notifications.deleteMany({ userId });
    await this.follows.deleteMany({ userId });
    await this.memberships.deleteMany({ userId });
    await this.shareLinks.deleteMany({ createdBy: userId });

    if (user.avatarMediaId) tally.media += await this.purgeMedia({ id: user.avatarMediaId });

    tally.entries += await this.deleteEntries({ authorId: userId, growId: null, spaceId: null, deviceId: null, cameraId: null });
    tally.media += await this.purgeMedia({ uploadedBy: userId, cameraId: null, growId: null, spaceId: null });
  }

  /**
   * What the account made in somebody else's place, which that place goes on
   * working from: an invitation whose owner was told nothing about it being
   * withdrawn, and a recurring task the whole space follows. Neither is the
   * author's to take away - what stood in this account's own spaces and grows
   * has already gone with them - so what is left is handed to whoever owns the
   * subject it belongs to, and only what has no subject any more is deleted.
   */
  private async handOverWhatIsLeftElsewhere(userId: string): Promise<void> {
    const invites = await this.invites.find({ createdBy: userId }, { id: 1, spaceId: 1 }).lean();
    await this.handOver(
      this.invites,
      invites.map(invite => ({ id: invite.id, subject: { type: 'space' as const, id: invite.spaceId } })),
    );

    const reminders = await this.reminders.find({ createdBy: userId }, { id: 1, subject: 1 }).lean();
    await this.handOver(
      this.reminders,
      reminders.map(reminder => ({ id: reminder.id, subject: reminder.subject })),
    );
  }

  /** Each row to the owner of the subject it is about, and away with the ones whose subject is gone. */
  private async handOver<T>(model: Model<T>, rows: { id: string; subject: Subject }[]): Promise<void> {
    if (rows.length === 0) return;

    const owners = await this.ownersOf(rows.map(row => row.subject));
    const byOwner = new Map<string | null, string[]>();
    for (const row of rows) {
      const owner = owners.get(keyOf(row.subject)) ?? null;
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), row.id]);
    }

    for (const [owner, ids] of byOwner) {
      const which = { id: { $in: ids } } as FilterQuery<T>;
      if (owner === null) await model.deleteMany(which);
      else await model.updateMany(which, { $set: { createdBy: owner } } as UpdateQuery<T>);
    }
  }

  /** Who owns each subject named, with nothing at all for the ones that are no longer there. */
  private async ownersOf(subjects: Subject[]): Promise<Map<string, string>> {
    const idsOf = (type: Subject['type']): string[] => subjects.filter(subject => subject.type === type).map(subject => subject.id);
    const owners = new Map<string, string>();

    for (const space of await this.spaces.find({ id: { $in: idsOf('space') } }, { id: 1, ownerId: 1 }).lean()) {
      owners.set(`space:${space.id}`, space.ownerId);
    }
    for (const grow of await this.grows.find({ id: { $in: idsOf('grow') } }, { id: 1, ownerId: 1 }).lean()) {
      owners.set(`grow:${grow.id}`, grow.ownerId);
    }

    return owners;
  }

  /**
   * What is left names the account on a row that belongs to somebody else, and
   * only the attribution is theirs to lose: a member writes into the space
   * owner's diary, and deleting the member would tear a hole in a record that is
   * not the member's. An empty author already means a line nobody in particular
   * wrote, which is how these read afterwards.
   *
   * Somebody else's is all these updates are meant to reach, and all they are
   * given: a line or a picture about nothing in particular is the account's own
   * and is collected by the step above, which finds it by the very field this
   * one would empty. Emptying it there too would strand it beyond finding if a
   * run stopped anywhere between the two.
   */
  private async forgetTheAuthor(userId: string): Promise<void> {
    await this.entries.updateMany(
      { authorId: userId, ...aboutSomething(['growId', 'spaceId', 'deviceId', 'cameraId']) },
      { $set: { authorId: null } },
    );
    await this.media.updateMany({ uploadedBy: userId, ...aboutSomething(['cameraId', 'growId', 'spaceId']) }, { $set: { uploadedBy: null } });
    await this.memberships.updateMany({ invitedBy: userId }, { $set: { invitedBy: null } });
    await this.reminders.updateMany({ assigneeId: userId }, { $set: { assigneeId: null } });
    await this.grows.updateMany({ 'phases.setBy': userId }, { $set: { 'phases.$[p].setBy': null } }, { arrayFilters: [{ 'p.setBy': userId }] });
  }

  // ---------------------------------------------------------------------------
  // The two deletes that need care
  // ---------------------------------------------------------------------------

  /**
   * Pictures, in bounded passes, and the bytes before the rows.
   *
   * A pass that dies having freed a batch's bytes leaves rows whose files are
   * gone, which the next pass deletes and which nothing else ever reads; the
   * other way round it leaves files that no row names, which nothing in the run
   * can find again and only the daily orphan sweep would ever collect. The row
   * is still deleted through the model, whose hook is the one definition of
   * freeing a picture's bytes - here it simply finds nothing left to free.
   */
  private async purgeMedia(filter: FilterQuery<MediaDocument>): Promise<number> {
    let deleted = 0;

    for (;;) {
      const batch = await this.media.find(filter, { id: 1 }).limit(MEDIA_BATCH).lean();
      if (batch.length === 0) return deleted;

      const ids = batch.map(row => row.id);
      await deleteStoredImages(this.media.db.db!, ids);

      const removed = (await this.media.deleteMany({ id: { $in: ids } })).deletedCount ?? 0;
      // A batch that deletes nothing would be read again for ever; the filter
      // matching what the delete does not is not a reason to stop answering.
      if (removed === 0) return deleted;

      deleted += removed;
    }
  }

  private async deleteEntries(filter: FilterQuery<EntryDocument>): Promise<number> {
    return (await this.entries.deleteMany(filter)).deletedCount ?? 0;
  }
}

/** What a reminder is about, and what an invitation is about once its space is named. */
type Subject = ReminderDocument['subject'];

const keyOf = (subject: Subject): string => `${subject.type}:${subject.id}`;

/**
 * Rows that name at least one of these, which is what makes them somebody's
 * rather than nobody's. Every reference in the model is `null` where it means
 * nothing, so this is a question the query can ask.
 */
const aboutSomething = (fields: string[]): FilterQuery<unknown> => ({ $or: fields.map(field => ({ [field]: { $ne: null } })) });
