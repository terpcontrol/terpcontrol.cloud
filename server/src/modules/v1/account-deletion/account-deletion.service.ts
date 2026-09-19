import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { conflict } from '@common/v1/problem';
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
 * idempotent and resumable instead. `users.deletionStartedAt` is stamped first,
 * in the one write that either happened or did not, and the row itself is
 * deleted last - so any moment in between is a safe state to stop at, and the
 * marked row is the record of what is left to do. Every step derives its ids
 * from rows that are still there and deletes children before their parent, which
 * is what makes a second pass finish the work rather than trip over it.
 *
 * Two costs are deliberate and bounded. The guards verify a token and read no
 * row, so a user token already issued keeps verifying for its remaining five
 * minutes and a media token for its remaining thirty days - by which time they
 * resolve to nothing, because `access()` finds subjects by their owner and the
 * rows are gone. The alternative is a lookup on every request of every account.
 * And the run is inline: the caller waits for it, and a very large account makes
 * a long request. Resumability is the net under a crash, not a queue.
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
    const user = await this.accounts.require(userId);

    // The account the environment names is looked up by address and written back
    // on every boot, so deleting it either resurrects it in the middle of the run
    // or re-creates it under a new id and strands everything this one owned.
    if (user.email === this.auth.adminUsername) {
      throw conflict('admin_account_kept', 'That is the account this install is configured with, and it is not deleted from here.');
    }

    await this.accounts.beginDeletion(userId);
    await this.erase(user);
  }

  /** The accounts a run left half-deleted, finished with the same steps that began them. */
  public async resumeUnfinished(): Promise<number> {
    const pending = await this.accounts.deletionsUnfinished();
    if (pending.length === 0) return 0;

    logger.info(`Resuming ${pending.length} account deletion(s) that did not finish`);
    for (const id of pending) {
      const user = await this.accounts.byId(id);
      if (user) await this.erase(user);
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
   * Everything after the marker, in the order that makes any prefix of it safe:
   * first the cheap writes that stop the account being reachable, then the
   * objects it owns, children before parents, then what it left on other
   * people's rows, and the row itself last.
   */
  private async erase(user: StoredUser): Promise<void> {
    const userId = user.id;
    const tally: Tally = { spaces: 0, grows: 0, cameras: 0, devices: 0, entries: 0, media: 0 };

    await this.stopBeingReachable(userId);
    await this.eraseCameras(userId, tally);
    await this.unclaimDevices(userId, tally);
    await this.eraseGrows(userId, tally);
    await this.eraseSpaces(userId, tally);
    await this.eraseOwnRowsElsewhere(user, tally);
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
   * diary goes on being served.
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
   * The cameras, before the devices: releasing a device's claim tombstones the
   * cameras its controller answered for, and a tombstone is not enough here. A
   * controller reporting the same webcam again revives the row it finds by that
   * webcam's pairing id, tombstone and all, and the row it revives still names
   * an owner who no longer exists.
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
      if (named.length > 0) tally.media += await this.purgeMedia({ id: { $in: named } });

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
      tally.media += await this.purgeMedia({ spaceId: { $in: spaceIds } });
      tally.entries += await this.deleteEntries({ spaceId: { $in: spaceIds } });
      await this.memberships.deleteMany({ spaceId: { $in: spaceIds } });
      await this.invites.deleteMany({ spaceId: { $in: spaceIds } });
      await this.shareLinks.deleteMany({ 'subject.type': 'space', 'subject.id': { $in: spaceIds } });
      await this.reminders.deleteMany({ 'subject.type': 'space', 'subject.id': { $in: spaceIds } });
      await this.alerts.deleteMany({ spaceId: { $in: spaceIds } });

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
    await this.invites.deleteMany({ createdBy: userId });
    await this.shareLinks.deleteMany({ createdBy: userId });
    await this.reminders.deleteMany({ createdBy: userId });

    if (user.avatarMediaId) tally.media += await this.purgeMedia({ id: user.avatarMediaId });

    tally.entries += await this.deleteEntries({ authorId: userId, growId: null, spaceId: null, deviceId: null, cameraId: null });
    tally.media += await this.purgeMedia({ uploadedBy: userId, cameraId: null, growId: null, spaceId: null });
  }

  /**
   * What is left names the account on a row that belongs to somebody else, and
   * only the attribution is theirs to lose: a member writes into the space
   * owner's diary, and deleting the member would tear a hole in a record that is
   * not the member's. An empty author already means a line nobody in particular
   * wrote, which is how these read afterwards.
   *
   * After the step above, never before it: that one finds the account's own
   * orphans by the very fields this one empties.
   */
  private async forgetTheAuthor(userId: string): Promise<void> {
    await this.entries.updateMany({ authorId: userId }, { $set: { authorId: null } });
    await this.media.updateMany({ uploadedBy: userId }, { $set: { uploadedBy: null } });
    await this.memberships.updateMany({ invitedBy: userId }, { $set: { invitedBy: null } });
    await this.reminders.updateMany({ assigneeId: userId }, { $set: { assigneeId: null } });
    await this.grows.updateMany({ 'phases.setBy': userId }, { $set: { 'phases.$[p].setBy': null } }, { arrayFilters: [{ 'p.setBy': userId }] });
  }

  // ---------------------------------------------------------------------------
  // The two deletes that need care
  // ---------------------------------------------------------------------------

  /**
   * Pictures, in bounded passes and always through the model: the bytes in the
   * store are freed by a hook on the delete itself, which a raw driver call or a
   * bulk write would go around and leave megabytes behind per picture. Deleting
   * in batches is also what makes this the resumable part of the run - a pass
   * that dies has already freed everything it got through.
   */
  private async purgeMedia(filter: FilterQuery<MediaDocument>): Promise<number> {
    let deleted = 0;

    for (;;) {
      const batch = await this.media.find(filter, { id: 1 }).limit(MEDIA_BATCH).lean();
      if (batch.length === 0) return deleted;

      const removed = (await this.media.deleteMany({ id: { $in: batch.map(row => row.id) } })).deletedCount ?? 0;
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
