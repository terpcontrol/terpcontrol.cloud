import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MemberRole } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { AccessContext, AccessRange, Grant, Grantee, Need, ResolvedSubject, SubjectRef, SubjectType } from './access.types';
import { forbidden, notFound } from './problem';

/**
 * One function decides every request: `access(ctx, subject, need)`.
 *
 * Whatever the request is about is resolved to the same handful of facts - who
 * owns it, which spaces it is in, whether it is a demo object, whether it
 * belongs to a public grow - and the decision is then the same for all of them.
 * Routes declare the need; nothing else about a caller is consulted anywhere.
 *
 * The answer is not a yes but a `Grant`: what a reader is allowed to see is as
 * much part of the decision as whether they may look at all, so the window every
 * read clamps to, whose privacy settings apply and whether camera pictures are
 * part of the answer ride back with it.
 */

const OPEN: AccessRange = { startsAt: null, endsAt: null };

/** What a refusal says was wanted, in words rather than in the name of the need. */
const REFUSED: Readonly<Record<Need, string>> = { own: 'owned', manage: 'managed', log: 'written to', view: 'read' };

/** What editing an entry needs: one's own is `log`, anybody else's is `manage`. */
export const needToEditEntry = (ctx: AccessContext, authorId: string | null): Need =>
  !ctx.isDemo && ctx.userId !== null && ctx.userId === authorId ? 'log' : 'manage';

@Injectable()
export class AccessService {
  constructor(
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.shareLink) private readonly shareLinks: Model<ShareLinkDocument>,
  ) {}

  /** The decision itself. `null` is a refusal, and so is a subject that does not exist. */
  public async access(ctx: AccessContext, ref: SubjectRef, need: Need): Promise<Grant | null> {
    const subject = await this.resolve(ref, need);
    return subject ? this.decide(ctx, subject, need) : null;
  }

  /**
   * The same decision as a demand. A caller who may not even look at the thing
   * is told it is not there, so that a refusal never reports whether something
   * exists to somebody who is not allowed to know.
   */
  public async require(ctx: AccessContext, ref: SubjectRef, need: Need): Promise<Grant> {
    const grant = await this.access(ctx, ref, need);
    if (grant) return grant;

    const visible = need === 'view' ? null : await this.access(ctx, ref, 'view');
    throw visible
      ? forbidden('insufficient_access', `This ${ref.type} may be read but not ${REFUSED[need]} by you.`)
      : notFound(`${ref.type}_not_found`, `There is no ${ref.type} with that id.`);
  }

  // -------------------------------------------------------------------------
  // The decision
  // -------------------------------------------------------------------------

  private async decide(ctx: AccessContext, subject: ResolvedSubject, need: Need): Promise<Grant | null> {
    if (ctx.isAdmin) return this.grant(subject, need, 'admin');

    if (ctx.isDemo) {
      if (subject.isDemo && need === 'view') return this.grant(subject, need, 'demo');
      // A demo session is a tour and not an account, so it is nobody's owner and
      // nobody's member - but it may still open a public page or a link.
    }

    const userId = ctx.isDemo ? null : ctx.userId;

    if (userId !== null && subject.ownerId === userId) return this.grant(subject, need, 'owner');

    if (userId !== null && subject.spaceIds.length > 0) {
      const role = await this.roleIn(userId, subject.spaceIds);
      // A member logs and reads; managing takes the second role, and owning is
      // never a membership.
      if (role !== null) return need === 'own' || (need === 'manage' && role !== 'can_manage') ? null : this.grant(subject, need, 'member');
    }

    if (need !== 'view') return null;

    if (subject.isPublic) return this.grant(subject, need, 'public');

    const link = await this.coveringLink(ctx, subject);
    return link ? this.grant(subject, need, 'share', link) : null;
  }

  private grant(subject: ResolvedSubject, need: Need, grantee: Grantee, link?: ShareLinkDocument): Grant {
    const full = grantee === 'admin' || grantee === 'owner' || grantee === 'member';

    return {
      need,
      subject: subject.ref,
      grantee,
      range: link ? { startsAt: link.range.startsAt, endsAt: link.range.endsAt } : (this.rangeOf(subject, grantee) ?? OPEN),
      privacyOwnerId: subject.ownerId,
      redacted: !full,
      includeCameras: link ? link.includeCameras : true,
    };
  }

  /** A public grow is readable for as long as it ran, and no further. */
  private rangeOf(subject: ResolvedSubject, grantee: Grantee): AccessRange | null {
    return grantee === 'public' ? subject.publicRange : null;
  }

  private async roleIn(userId: string, spaceIds: string[]): Promise<MemberRole | null> {
    const rows = await this.memberships.find({ userId, spaceId: { $in: spaceIds } }, { role: 1 }).lean();
    if (rows.length === 0) return null;

    // A membership on the room and one on the space inside it are both real; the
    // stronger of the two is what the person has.
    return rows.some(row => row.role === 'can_manage') ? 'can_manage' : 'can_log';
  }

  /**
   * The link the request came in on, when it is still valid and reaches this
   * subject. A link on a grow covers the grow and everything that names it; a
   * link on a space covers whatever stands in that space.
   */
  private async coveringLink(ctx: AccessContext, subject: ResolvedSubject): Promise<ShareLinkDocument | null> {
    if (!ctx.shareToken) return null;

    const link = await this.shareLinks.findOne({ token: ctx.shareToken }).lean();
    if (!link || link.revokedAt !== null) return null;
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) return null;

    const covers = link.subject.type === 'grow' ? subject.growIds.includes(link.subject.id) : subject.spaceIds.includes(link.subject.id);
    if (!covers) return null;

    // Pictures are the one thing a link does not carry unless it was made to.
    return subject.ofACamera && !link.includeCameras ? null : link;
  }

  // -------------------------------------------------------------------------
  // Resolution: every subject down to the same facts
  // -------------------------------------------------------------------------

  private async resolve(ref: SubjectRef, need: Need): Promise<ResolvedSubject | null> {
    switch (ref.type) {
      case 'space':
        return this.ofSpace(ref, ref.id);
      case 'grow':
        return this.ofGrow(ref, ref.id, need);
      case 'plant': {
        const plant = await this.plants.findOne({ id: ref.id }, { growId: 1 }).lean();
        return plant ? this.ofGrow(ref, plant.growId, need) : null;
      }
      case 'device': {
        const device = await this.devices.findOne({ id: ref.id }, { ownerId: 1, spaceId: 1, isDemo: 1 }).lean();
        return device ? { ...(await this.inSpaces(ref, device.spaceId)), ownerId: device.ownerId, isDemo: device.isDemo } : null;
      }
      case 'camera': {
        const camera = await this.cameras.findOne({ id: ref.id }, { ownerId: 1, spaceId: 1, isDemo: 1 }).lean();
        return camera ? { ...(await this.inSpaces(ref, camera.spaceId)), ownerId: camera.ownerId, isDemo: camera.isDemo, ofACamera: true } : null;
      }
      case 'entry': {
        const entry = await this.entries.findOne({ id: ref.id }).lean();
        if (!entry) return null;

        const subject = await this.ofAttachment(ref, need, entry.growId, entry.spaceId, entry.deviceId);
        return { ...subject, authorId: entry.authorId };
      }
      case 'media': {
        const picture = await this.media.findOne({ id: ref.id }).lean();
        if (!picture) return null;

        const subject = await this.ofAttachment(ref, need, picture.growId, picture.spaceId, null, picture.cameraId, picture.capturedAt);
        return { ...subject, ofACamera: picture.cameraId !== null };
      }
    }
  }

  /**
   * An entry and a picture belong to whatever they name, in this order: the grow
   * they are about, else the space they happened in, else the device or the
   * camera that recorded them. Each is an owner and a set of spaces, and a grow
   * is also what makes them public.
   */
  private async ofAttachment(
    ref: SubjectRef,
    need: Need,
    growId: string | null,
    spaceId: string | null,
    deviceId: string | null,
    cameraId: string | null = null,
    takenAt: Date | null = null,
  ): Promise<ResolvedSubject> {
    if (growId !== null) {
      const grow = await this.ofGrow(ref, growId, need);
      if (grow) return { ...grow, spaceIds: [...new Set([...grow.spaceIds, ...(await this.widen([spaceId]))])] };
    }

    if (spaceId !== null) {
      const space = await this.ofSpace(ref, spaceId);
      if (space) return space;
    }

    if (deviceId !== null) {
      const device = await this.devices.findOne({ id: deviceId }, { ownerId: 1, spaceId: 1, isDemo: 1 }).lean();
      if (device) return { ...(await this.inSpaces(ref, device.spaceId)), ownerId: device.ownerId, isDemo: device.isDemo };
    }

    if (cameraId !== null) {
      const camera = await this.cameras.findOne({ id: cameraId }, { ownerId: 1, spaceId: 1, isDemo: 1 }).lean();
      if (camera) {
        return {
          ...(await this.inSpaces(ref, camera.spaceId)),
          ownerId: camera.ownerId,
          isDemo: camera.isDemo,
          // A still names no grow: it belongs to the camera that took it. What
          // it is a picture of is whatever stood in front of that camera when
          // the shutter closed - which is what a link onto that grow was made
          // to show, and without it a link that includes cameras reaches none
          // of the pictures its own week cards point at. It makes no picture
          // public: a grow read through its own address is granted `view` by
          // being public, and a camera never is, so a still is still refused to
          // anybody who does not hold a link that carries cameras.
          growIds: takenAt ? await this.growsInSpaceAt(camera.spaceId, takenAt) : [],
        };
      }
    }

    // Attached to nothing that still exists: nobody's but an admin's.
    return this.blank(ref);
  }

  private async ofSpace(ref: SubjectRef, id: string): Promise<ResolvedSubject | null> {
    const space = await this.spaces.findOne({ id }, { ownerId: 1, roomId: 1, isDemo: 1 }).lean();
    if (!space) return null;

    return {
      ...this.blank(ref),
      ownerId: space.ownerId,
      isDemo: space.isDemo,
      // Its own membership, and the one on the room it stands in.
      spaceIds: space.roomId ? [id, space.roomId] : [id],
    };
  }

  /**
   * A grow's spaces are all its placements for `view` and only the open ones for
   * `log` and `manage`: somebody who may log in a tent may log in the grow that
   * stands there now, and may still read the one that stood there in spring.
   */
  private async ofGrow(ref: SubjectRef, id: string, need: Need): Promise<ResolvedSubject | null> {
    const grow = await this.grows.findOne({ id }, { id: 1, ownerId: 1, isDemo: 1, visibility: 1, placements: 1, startedAt: 1, endedAt: 1 }).lean();
    if (!grow) return null;

    const placements = need === 'view' ? grow.placements : grow.placements.filter(placement => placement.endedAt === null);
    const isPublic = grow.visibility === 'public';

    return {
      ...this.blank(ref),
      ownerId: grow.ownerId,
      isDemo: grow.isDemo,
      isPublic,
      spaceIds: await this.widen(placements.map(placement => placement.spaceId)),
      growIds: [grow.id],
      publicRange: isPublic ? { startsAt: grow.startedAt, endsAt: grow.endedAt ?? new Date() } : null,
    };
  }

  /**
   * The grows that stood in a space at one instant. A tent holds one most of the
   * time and two while a grow is being handed over, and a picture taken then is
   * a picture of both.
   */
  private async growsInSpaceAt(spaceId: string | null, at: Date): Promise<string[]> {
    if (spaceId === null) return [];

    const rows = await this.grows
      .find({ placements: { $elemMatch: { spaceId, startedAt: { $lte: at }, $or: [{ endedAt: null }, { endedAt: { $gt: at } }] } } }, { id: 1 })
      .lean();

    return rows.map(grow => grow.id);
  }

  private async inSpaces(ref: SubjectRef, spaceId: string | null): Promise<ResolvedSubject> {
    return { ...this.blank(ref), spaceIds: await this.widen([spaceId]) };
  }

  /** The spaces themselves and the rooms they stand in, because a membership on a room covers its spaces. */
  private async widen(spaceIds: (string | null)[]): Promise<string[]> {
    const named = spaceIds.filter((id): id is string => id !== null);
    if (named.length === 0) return [];

    const spaces = await this.spaces.find({ id: { $in: named } }, { id: 1, roomId: 1 }).lean();
    const widened = new Set(named);
    for (const space of spaces) {
      if (space.roomId) widened.add(space.roomId);
    }

    return [...widened];
  }

  private blank(ref: SubjectRef): ResolvedSubject {
    return {
      ref,
      ownerId: null,
      isDemo: false,
      isPublic: false,
      spaceIds: [],
      growIds: [],
      publicRange: null,
      ofACamera: false,
      authorId: null,
    };
  }
}

/** For the routes and the guard: a subject named in one place rather than spelled out at each call. */
export const subjectRef = (type: SubjectType, id: string): SubjectRef => ({ type, id });
