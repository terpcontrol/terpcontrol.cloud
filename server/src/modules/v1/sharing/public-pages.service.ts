import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { FollowedGrowCard, GrowWeekCard, LinkCard, PublicAuthor, PublicGrowPage, PublicUserPage, SharedResolution } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, AccessRange, Grant } from '@common/v1/access.types';
import { CursorPage } from '@common/v1/pages';
import { clampRange } from '@common/v1/range';
import { notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { MediaService } from '../camera/media.service';
import { diaryMovedAt } from '../diary/diary-entries';
import { spacesDuring } from '../diary/grow-places';
import { GrowReportService, harvestOf } from '../diary/report.service';
import { GrowWeeksService } from '../diary/weeks.service';
import { growUpTo, redactionOf, serialisePublicCard, summaryOf } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';
import { OverviewService } from '../overview/overview.service';
import { ShareLinksService } from './share-links.service';

/**
 * A diary read by somebody who is not in it: through the grow's own public
 * address, or through a link that was sent to them.
 *
 * The two are the same page by two keys, which is why they are built here
 * together. What differs is only the grant: a public grow is readable for as
 * long as it ran, a link for the window it carries, and a link that was not made
 * to carry pictures shows none. Everything below is built from that grant and
 * never from the caller, so a route cannot forget to clamp.
 *
 * **What a page costs.** The grow and its plants, its owner, the totals as one
 * aggregate, and then the week cards - which is where the real cost is: one
 * time-series read per week per controller. The page carries as many of them as
 * a reader opening on the newest week will get through, and says with a cursor
 * that there are more; the weeks before those are a page of their own, so a
 * diary that ran a year costs a reader who stops after a screenful no more than
 * a diary that ran a month.
 */

/**
 * How many weeks a page of a public diary carries. Half a year, which is longer
 * than most grows run and far more than anybody scrolls in one go; the weeks
 * before it are read a page at a time through the weeks route, which is what
 * keeps a two-year perpetual from being a page nobody waits for.
 */
const WEEKS_ON_A_PUBLIC_PAGE = 26;

@Injectable()
export class PublicPagesService {
  constructor(
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.grow) private readonly growRows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    private readonly grows: GrowsService,
    private readonly files: MediaService,
    private readonly weeks: GrowWeeksService,
    private readonly report: GrowReportService,
    private readonly overview: OverviewService,
    private readonly links: ShareLinksService,
    private readonly access: AccessService,
  ) {}

  // -------------------------------------------------------------------------
  // A grow at its own address
  // -------------------------------------------------------------------------

  /**
   * The grow behind a public address, with the grant a stranger reads it
   * through. A grow that is not public is not there: a refusal would say that
   * the address is taken, which is one bit more than a stranger is owed.
   */
  public async publicGrow(ctx: AccessContext, slug: string): Promise<{ grow: GrowDocument; grant: Grant }> {
    const grow = await this.grows.bySlug(slug);
    if (!grow || grow.visibility !== 'public') throw notFound('grow_not_found', 'There is no public grow at that address.');

    return { grow, grant: await this.access.require(ctx, subjectRef('grow', grow.id), 'view') };
  }

  /**
   * The page itself. `range` is answered back because it is what everything
   * below has already been clamped to, and a reader who asks why a week is
   * missing has the window in front of them.
   */
  public async growPage(grow: GrowDocument, grant: Grant, now: Date = new Date()): Promise<PublicGrowPage> {
    const range = clampRange(grant);
    // Where the story stops for this reader. Everything the page states about
    // the grow as a whole - the day it is on, the stage it is in, whether it is
    // over - is worked out here rather than now, because a link whose window
    // closed in August was not sent September.
    const until = range.endsAt && range.endsAt < now ? range.endsAt : now;
    const seen = growUpTo(grow, until);

    const [hide, plants, owner, page, totals] = await Promise.all([
      this.grows.redaction(grant),
      this.grows.plantsOf(grow.id),
      this.ownerOf(grow.ownerId),
      this.weeks.page(grow.id, grant, { limit: WEEKS_ON_A_PUBLIC_PAGE }, now),
      this.report.totalsOf(grow.id, grant),
    ]);

    const summary = summaryOf(seen, plants, hide, until);

    return {
      slug: grow.slug,
      // What a reader follows is the grow, and only a diary with a public page
      // of its own can be followed at all - so a link onto a private diary
      // hands over no id, exactly as it hands over no handle to look one up by.
      growId: grow.visibility === 'public' ? grow.id : null,
      name: grow.name,
      description: grow.description,
      type: grow.type,
      author: authorOf(owner),
      startedAt: grow.startedAt.toISOString(),
      endedAt: seen.endedAt?.toISOString() ?? null,
      dayNumber: summary.dayNumber,
      stage: summary.stage,
      preset: summary.preset,
      // The week of the stage rather than of the grow, because the line the
      // page draws it on names the stage: a reader told "Curing · week 32"
      // takes that for thirty-two weeks of curing. It is the same figure the
      // owner's own header states and the same one the first week card's pill
      // carries, worked out against the reader's window like everything else
      // here.
      stageWeek: summary.stageWeek,
      plantCount: hide.counts ? null : plants.length,
      strains: [...new Set(plants.map(plant => plant.strain))],
      coverMediaId: grow.coverMediaId,
      filmMediaId: grow.filmMediaId,
      range: { startsAt: range.startsAt?.toISOString() ?? null, endsAt: range.endsAt?.toISOString() ?? null },
      includeCameras: grant.includeCameras,
      weeks: page.items,
      weeksCursor: page.nextCursor,
      // A harvest is dated, so it belongs to the window like any other line: a
      // plant that came down after a link's window closed has not come down as
      // far as that link is concerned, and a grow whose whole harvest is outside
      // it has none to state.
      harvest: harvestOf(
        plants.filter(plant => harvestedWithin(plant, range)),
        hide,
      ),
      totals,
    };
  }

  /**
   * The weeks before the ones a page carried, and the weeks before those.
   *
   * It is the same read the page itself makes, by the same grant, so a week
   * reached through it is clamped exactly as a week on the page was and a long
   * diary cannot be walked into a window its reader was never given. What the
   * owner's own weeks route answers beside the cards - the people its lines
   * name - is dropped here, because a public diary is by one author and names
   * nobody else.
   */
  public async weeksPage(grow: GrowDocument, grant: Grant, query: PageQuery, now: Date = new Date()): Promise<CursorPage<GrowWeekCard>> {
    const page = await this.weeks.page(grow.id, grant, { cursor: query.cursor, limit: query.limit ?? WEEKS_ON_A_PUBLIC_PAGE }, now);

    return { items: page.items, nextCursor: page.nextCursor };
  }

  // -------------------------------------------------------------------------
  // A person at their own address
  // -------------------------------------------------------------------------

  /**
   * Somebody's public diaries. The profile exists only where its owner turned it
   * on, so a handle whose owner did not is not there rather than an empty page -
   * an empty page would still confirm that the handle is taken.
   */
  public async publicUser(handle: string): Promise<{ author: StoredUser; grows: GrowDocument[] }> {
    const author = await this.users.findOne({ handle, publicProfile: true, isActive: true, deletionStartedAt: null }).lean<StoredUser>();
    if (!author) throw notFound('user_not_found', 'There is no public profile at that address.');

    // Newest first: a profile opens on what its author is growing now.
    const grows = await this.growRows.find({ ownerId: author.id, visibility: 'public' }).sort({ updatedAt: -1, id: -1 }).lean<GrowDocument[]>();

    return { author, grows };
  }

  public async userPage(author: StoredUser, grows: GrowDocument[], now: Date = new Date()): Promise<PublicUserPage> {
    return { author: authorOf(author), grows: await this.cardsOf(author, grows, now) };
  }

  /**
   * The same card the home screen draws for a grow somebody follows: a public
   * grow reads one way wherever it is listed.
   *
   * The cards are ordered by the same figure they are dated with, rather than by
   * the order the grows were read in: a profile opens on the diary with the
   * newest line in it, and a page whose top card is dated older than the one
   * below it would be a list sorted by something it does not show.
   */
  private async cardsOf(author: StoredUser, grows: GrowDocument[], now: Date): Promise<FollowedGrowCard[]> {
    if (grows.length === 0) return [];

    const [plants, moved] = await Promise.all([
      this.plants.find({ growId: { $in: grows.map(grow => grow.id) } }).lean<PlantDocument[]>(),
      diaryMovedAt(
        this.entries,
        grows.map(grow => grow.id),
      ),
    ]);
    const hide = redactionOf(true, author.privacy);

    return grows
      .map(grow =>
        serialisePublicCard(
          grow,
          plants.filter(plant => plant.growId === grow.id),
          author.handle,
          hide,
          moved.get(grow.id) ?? null,
          now,
        ),
      )
      .sort((one, other) => other.updatedAt.localeCompare(one.updatedAt));
  }

  // -------------------------------------------------------------------------
  // A link
  // -------------------------------------------------------------------------

  /**
   * What a token leads to. Never the link itself: the token is the reader's only
   * proof, and the link's counters, its owner and the rest of its settings are
   * none of their business.
   *
   * The decision is `access()`'s, asked as the reader who holds nothing but the
   * token - so a session that happens to own the grow reads it here exactly as
   * the person it was sent to does. The grant that comes back is then narrowed
   * by the link again, because a link onto a grow that is public anyway would
   * otherwise be granted the grow's whole life rather than its own window.
   */
  public async resolve(token: string, now: Date = new Date()): Promise<SharedResolution> {
    const { link, grant } = await this.keyOf(token, now);
    const range = clampRange(grant);

    return {
      kind: link.kind,
      range: { startsAt: range.startsAt?.toISOString() ?? null, endsAt: range.endsAt?.toISOString() ?? null },
      includeCameras: grant.includeCameras,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      subject: await this.subjectOf(link, grant, now),
    };
  }

  /**
   * What a token opens, as the link it is and the grant it carries. Both routes
   * a link has go through this, so the narrowing below is stated once and a
   * second route onto the same diary cannot be given a wider window than the
   * page the reader came from.
   */
  private async keyOf(token: string, now: Date): Promise<{ link: ShareLinkDocument; grant: Grant }> {
    const link = await this.links.open(token, now);
    const reader: AccessContext = { userId: null, isAdmin: false, isDemo: false, shareToken: link.token };

    const granted = await this.access.access(reader, subjectRef(link.subject.type, link.subject.id), 'view');
    // The subject is gone, or the link no longer reaches it. Either way the
    // reader learns nothing beyond "this address leads nowhere".
    if (!granted) throw notFound('share_link_not_found', 'That link leads nowhere.');

    return {
      link,
      grant: {
        ...granted,
        range: clampRange(granted, { startsAt: link.range.startsAt, endsAt: link.range.endsAt }),
        includeCameras: granted.includeCameras && link.includeCameras,
      },
    };
  }

  /**
   * The earlier weeks of the diary a link leads to. A link onto a tent has no
   * weeks, and says so rather than answering an empty page, which would read as
   * a diary with nothing in it.
   */
  public async sharedWeeks(token: string, query: PageQuery, now: Date = new Date()): Promise<CursorPage<GrowWeekCard>> {
    const { link, grant } = await this.keyOf(token, now);
    if (link.subject.type !== 'grow') throw notFound('grow_not_found', 'That link does not lead to a grow diary.');

    return this.weeksPage(await this.grows.require(link.subject.id), grant, query, now);
  }

  private async subjectOf(link: ShareLinkDocument, grant: Grant, now: Date): Promise<SharedResolution['subject']> {
    if (link.subject.type === 'space') return { type: 'space', space: await this.overview.read(grant, link.subject.id, now) };

    const grow = await this.grows.require(link.subject.id);
    return { type: 'grow', grow: await this.growPage(grow, grant, now) };
  }

  // -------------------------------------------------------------------------
  // Pictures
  // -------------------------------------------------------------------------

  /** One picture of a public grow, and of no other; `belongsToGrow` below is what decides. */
  public async pictureOf(grow: GrowDocument, grant: Grant, mediaId: string): Promise<MediaDocument> {
    const picture = await this.media.findOne({ id: mediaId }).lean<MediaDocument>();
    if (!picture) throw notFound('media_not_found', 'There is no picture of that grow with that id.');

    // Two lookups the decision needs and cannot make for itself: whose face is
    // beside the handle, and where the camera that took this was pointing.
    const [owner, camera] = await Promise.all([
      this.ownerOf(grow.ownerId),
      picture.cameraId === null
        ? Promise.resolve(null)
        : this.cameras.findOne({ id: picture.cameraId }, { spaceId: 1 }).lean<Pick<CameraDocument, 'spaceId'>>(),
    ]);

    if (!belongsToGrow(grow, grant, picture, owner?.avatarMediaId ?? null, camera?.spaceId ?? null)) {
      throw notFound('media_not_found', 'There is no picture of that grow with that id.');
    }

    return picture;
  }

  // -------------------------------------------------------------------------
  // The card the two shells are drawn from
  // -------------------------------------------------------------------------

  /** What a chat window says about a grow, and what `card.png` draws. One shape, so the two agree. */
  public async growCard(grow: GrowDocument, baseUrl: string, now: Date = new Date()): Promise<LinkCard> {
    const [plants, owner] = await Promise.all([this.grows.plantsOf(grow.id), this.ownerOf(grow.ownerId)]);
    const hide = redactionOf(true, owner?.privacy);
    const summary = summaryOf(grow, plants, hide, now);
    const handle = owner?.handle ?? null;

    return {
      title: grow.name,
      description: grow.description ?? sentenceFor(handle, summary.dayNumber, summary.stage),
      pageUrl: `${baseUrl}/g/${encodeURIComponent(grow.slug)}`,
      imageUrl: `${baseUrl}/v1/public/grows/${encodeURIComponent(grow.slug)}/card.png`,
      handle,
      dayNumber: summary.dayNumber,
      stage: summary.stage,
    };
  }

  /** The same for a person: their handle, their line of text, and how much there is to read. */
  public userCard(author: StoredUser, grows: GrowDocument[], baseUrl: string): LinkCard {
    return {
      title: `@${author.handle}`,
      description: author.bio ?? diaryCount(grows.length),
      pageUrl: `${baseUrl}/@${encodeURIComponent(author.handle)}`,
      imageUrl: `${baseUrl}/v1/public/users/${encodeURIComponent(author.handle)}/card.png`,
      handle: author.handle,
      dayNumber: null,
      stage: null,
    };
  }

  /** The picture a card is drawn over: a grow's cover, or the newest cover among somebody's diaries. */
  public coverOf(grows: GrowDocument[]): string | null {
    return grows.map(grow => grow.coverMediaId).find((id): id is string => id !== null) ?? null;
  }

  /**
   * The bytes of a cover, for the card to be drawn over. A cover that has been
   * deleted, or that is a film rather than a picture, costs the card its
   * backdrop and nothing else - a share card always renders.
   */
  public async bytesOf(mediaId: string | null): Promise<Buffer | null> {
    if (mediaId === null) return null;

    const picture = await this.media.findOne({ id: mediaId }, { id: 1, mime: 1 }).lean<Pick<MediaDocument, 'id' | 'mime'>>();
    if (!picture || !picture.mime.startsWith('image/')) return null;

    return this.files.download(picture.id).catch(() => null);
  }

  private ownerOf(ownerId: string | null): Promise<StoredUser | null> {
    return ownerId ? this.users.findOne({ id: ownerId }).lean<StoredUser>() : Promise.resolve(null);
  }
}

/** Whether a plant came down inside the window a reader holds. A plant that is still standing is not outside it. */
const harvestedWithin = (plant: PlantDocument, range: AccessRange): boolean => {
  if (!plant.harvest) return true;

  const at = plant.harvest.harvestedAt;
  return (!range.startsAt || at >= range.startsAt) && (!range.endsAt || at <= range.endsAt);
};

/**
 * Whether a picture is part of this grow's public page, which is the whole of
 * what makes it readable by a stranger.
 *
 * What the page draws is what it may fetch: a photo logged against the grow, its
 * cover, its film, the author's avatar, and a still of a camera that looked into
 * a space the plants stood in while they stood there. Anything else - a picture
 * of the same owner's other tent, a still taken after a link's window closed, a
 * still at all through a link that carries no cameras - is not there, even
 * though the same bytes sit in the same bucket.
 */
export const belongsToGrow = (
  grow: GrowDocument,
  grant: Grant,
  picture: MediaDocument,
  avatarMediaId: string | null,
  cameraSpaceId: string | null,
): boolean => {
  if (picture.id === grow.coverMediaId || picture.id === grow.filmMediaId) return true;
  if (picture.growId === grow.id) return true;
  // The author's own picture, which the page draws beside their handle. It
  // belongs to no grow and to no camera, so nothing else would ever let it out.
  if (avatarMediaId !== null && picture.id === avatarMediaId) return true;

  if (picture.cameraId === null || !grant.includeCameras || cameraSpaceId === null) return false;

  const range = clampRange(grant);
  const takenAt = picture.capturedAt;
  if ((range.startsAt && takenAt < range.startsAt) || (range.endsAt && takenAt > range.endsAt)) return false;

  // A camera that has since been removed keeps its pictures, so its tombstone
  // counts here exactly as a camera still hanging in the tent does.
  return spacesDuring(grow, takenAt, new Date(takenAt.getTime() + 1)).includes(cameraSpaceId);
};

/**
 * Who a page is by. A handle, and the profile only where its owner turned one
 * on: the handle is the only name anybody ever has here, and the line of text
 * and the picture beside it are the profile, which is a thing somebody decides
 * to publish.
 */
const authorOf = (owner: StoredUser | null): PublicAuthor => {
  if (!owner) return { handle: 'unknown', bio: null, avatarMediaId: null };

  return {
    handle: owner.handle,
    bio: owner.publicProfile ? owner.bio : null,
    avatarMediaId: owner.publicProfile ? owner.avatarMediaId : null,
  };
};

/** What a grow with no description of its own says about itself. */
const sentenceFor = (handle: string | null, dayNumber: number | null, stage: string | null): string => {
  const by = handle ? ` by @${handle}` : '';
  if (dayNumber === null) return `A grow diary${by}.`;

  return stage ? `A grow diary${by}, on day ${dayNumber} of ${stage}.` : `A grow diary${by}, on day ${dayNumber}.`;
};

const diaryCount = (count: number): string => {
  if (count === 0) return 'No public grow diaries yet.';

  return count === 1 ? 'One public grow diary.' : `${count} public grow diaries.`;
};
