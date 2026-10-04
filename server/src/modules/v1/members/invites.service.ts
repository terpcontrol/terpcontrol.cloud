import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'node:crypto';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { Invite, InviteAcceptance, InviteCreate, InvitePage, InvitePreview } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { InviteDocument } from '@database/schemas/v1/invites.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { MembersService } from './members.service';

/**
 * The `invites` collection: one code that is the link, the typed code and the
 * QR at once.
 *
 * Making, listing, revoking and deleting one are the owner's, because an invite
 * is a key to somebody's tent and cutting keys is not a thing a co-manager does
 * on their behalf. The two routes a stranger reaches - the preview and the
 * redemption - are addressed by the code alone, which is why the code is short
 * enough to read aloud and why both of them are rate limited.
 */

// The characters a code is made of: those that cannot be read as one another off
// a screen or over a telephone - no O or 0, no I, J, L or 1, no Q. The same
// alphabet a device's claim code uses, for the same reason.
const CODE_ALPHABET = 'ABCDEFGHKMNPRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** The board's default, and the one the sheet offers beside a day and never. */
const DEFAULT_DAYS = 7;

/**
 * A code is 8 of 29 characters, so guessing one is hopeless - but only as long
 * as guessing is slow. Both open routes are capped, and a few collisions on
 * generation are retried rather than answered as a failure.
 */
const GENERATION_ATTEMPTS = 8;

/** Everything a dead code answers, whatever killed it or whether it ever lived. */
const NOTHING_THERE: InvitePreview = { isValid: false, spaceName: null, spaceKind: null, role: null, invitedByHandle: null, expiresAt: null };

@Injectable()
export class InvitesService {
  constructor(
    @InjectModel(MODEL_V1.invite) private readonly invites: Model<InviteDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly members: MembersService,
    private readonly spacesService: SpacesService,
    private readonly access: AccessService,
  ) {}

  /** The codes out on a space, newest first: what the sharing sheet lists under the link it just made. */
  public async list(spaceId: string, query: PageQuery): Promise<InvitePage> {
    const limit = pageLimit(query.limit);
    // Combined rather than merged: the cursor is an `$or`, and spreading it
    // beside the space filter would replace it and list every invite there is.
    const conditions: FilterQuery<InviteDocument>[] = [{ spaceId }, afterCursor('createdAt', query.cursor)];

    const rows = await this.invites.find({ $and: conditions }).sort({ createdAt: -1, id: -1 }).limit(readLimit(limit)).lean<InviteDocument[]>();

    const page = pageOf(rows, limit, invite => ({ at: invite.createdAt, id: invite.id }));
    return { items: page.items.map(serialise), nextCursor: page.nextCursor };
  }

  /**
   * Cutting a key. The code, the space and who made it are the server's; what is
   * asked for is the role it grants and how long it lives, and a body that names
   * no end gets the week the sheet says it does - a link that outlives the
   * conversation it was pasted into is the one thing about link sharing that
   * cannot be taken back afterwards.
   */
  public async create(ctx: AccessContext, spaceId: string, body: InviteCreate): Promise<Invite> {
    const createdBy = this.members.accountOf(ctx);
    await this.members.require(spaceId);

    const invite: InviteDocument = {
      id: uuidv4(),
      code: await this.freshCode(),
      spaceId,
      role: body.role,
      createdBy,
      expiresAt: body.expiresAt === undefined ? inDays(DEFAULT_DAYS) : body.expiresAt === null ? null : new Date(body.expiresAt),
      revokedAt: null,
      state: { useCount: 0, lastUsedAt: null },
      createdAt: new Date(),
    };

    await this.invites.create(invite);
    return serialise(invite);
  }

  /**
   * Revoking is not deleting: the row stays listed with the instant it stopped
   * working on it, so that somebody who handed a link out can see that they did
   * and that it is over. Revoking twice does not move that instant.
   */
  public async revoke(ctx: AccessContext, code: string): Promise<Invite> {
    const invite = await this.requireOwned(ctx, code);
    if (invite.revokedAt !== null) return serialise(invite);

    const changed = await this.invites.findOneAndUpdate({ id: invite.id }, { $set: { revokedAt: new Date() } }, { new: true }).lean<InviteDocument>();
    if (!changed) throw notFound('invite_not_found', 'There is no invite with that code.');

    return serialise(changed);
  }

  /** Deleting takes the row with it. A link that was sent out and is regretted is revoked instead. */
  public async remove(ctx: AccessContext, code: string): Promise<void> {
    const invite = await this.requireOwned(ctx, code);
    await this.invites.deleteOne({ id: invite.id });
  }

  /**
   * What somebody who was sent a link sees before they sign in or sign up: where
   * they are being asked to, what they would be able to do there, and who is
   * asking - by handle, the only name anybody ever gets.
   *
   * Nothing else, and no id at all. A link lives in a chat group where it
   * outlives the conversation, so whatever this answers is what everybody in
   * that group can read: not the space's id, which would let a guesser ask
   * about it afterwards, not who else is in it, and nothing about what is
   * growing there.
   *
   * A code that is revoked, expired, on an archived space or was never issued
   * all answer the same empty preview. The person who was actually sent the link
   * learns that it is over, and nobody learns which of the four it was - so
   * working through codes tells a guesser no more than that they have not found
   * one.
   */
  public async preview(code: string, now: Date = new Date()): Promise<InvitePreview> {
    const invite = await this.invites.findOne({ code }).lean<InviteDocument>();
    if (!invite || !isOpen(invite, now)) return NOTHING_THERE;

    const space = await this.spaces.findOne({ id: invite.spaceId }, { name: 1, kind: 1, archivedAt: 1 }).lean<SpaceDocument>();
    if (!space || space.archivedAt !== null) return NOTHING_THERE;

    const inviter = await this.users.findOne({ id: invite.createdBy }, { handle: 1 }).lean<Pick<StoredUser, 'handle'>>();

    return {
      isValid: true,
      spaceName: space.name,
      spaceKind: space.kind,
      role: invite.role,
      invitedByHandle: inviter?.handle ?? null,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Redeeming a code, which is the one way into a space that its owner does not
   * perform. The role is the invite's and never the body's, and the space comes
   * back with the membership because somebody who has only ever seen a code
   * would otherwise hold two ids and no name.
   *
   * A dead code refuses exactly as an unissued one does, for the reason the
   * preview answers nothing: the route is reachable by anybody. Accepting twice
   * is refused rather than quietly repeated - the second tap is somebody who
   * thinks the first did not work, and telling them they are already in is the
   * true answer.
   */
  public async accept(ctx: AccessContext, code: string, now: Date = new Date()): Promise<InviteAcceptance> {
    const userId = this.members.accountOf(ctx);
    const gone = notFound('invite_not_found', 'That invite leads nowhere.');

    const invite = await this.invites.findOne({ code }).lean<InviteDocument>();
    if (!invite || !isOpen(invite, now)) throw gone;

    const space = await this.members.require(invite.spaceId);
    if (space.archivedAt !== null) throw gone;
    if (space.ownerId === userId) throw conflict('owner_here', 'You own this space, which is more than any invite gives.');

    const membership = await this.members.join(invite.spaceId, userId, invite.role, { invitedBy: invite.createdBy, inviteId: invite.id });
    await this.invites.updateOne({ id: invite.id }, { $inc: { 'state.useCount': 1 }, $set: { 'state.lastUsedAt': now } });

    return { membership, space: this.spacesService.serialise(space) };
  }

  /**
   * One invite, for somebody who owns the space it opens - owning the tent is
   * what makes its keys yours.
   *
   * Anybody else is told the code leads nowhere, in the same words a code
   * nobody ever issued gets, because these two routes are addressed by the code
   * alone and so are reachable by anybody with an account and a guess. Asking
   * the space's own refusal to answer would have said which: a live code on
   * somebody else's tent refused one way and an invented one the other, and
   * the difference is a yes or no on every string tried - which is the whole of
   * what the preview refuses to give away, at the speed of the API.
   */
  private async requireOwned(ctx: AccessContext, code: string): Promise<InviteDocument> {
    const gone = notFound('invite_not_found', 'There is no invite with that code.');

    const invite = await this.invites.findOne({ code }).lean<InviteDocument>();
    if (!invite) throw gone;

    const mine = await this.access.access(ctx, subjectRef('space', invite.spaceId), 'own');
    if (!mine) throw gone;

    return invite;
  }

  /** A code nothing else holds. Unique in the index too, so a race loses at the write rather than here. */
  private async freshCode(): Promise<string> {
    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (!(await this.invites.exists({ code }))) return code;
    }

    throw conflict('code_unavailable', 'No free invite code could be found. Please try again.');
  }
}

/** Neither revoked nor past its day. Whether the space still stands is asked separately. */
const isOpen = (invite: InviteDocument, now: Date): boolean =>
  invite.revokedAt === null && (invite.expiresAt === null || invite.expiresAt.getTime() > now.getTime());

const inDays = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** Field by field, because `_id` rides on a stored document and never leaves the server. */
const serialise = (invite: InviteDocument): Invite => ({
  id: invite.id,
  code: invite.code,
  spaceId: invite.spaceId,
  role: invite.role,
  createdBy: invite.createdBy,
  expiresAt: invite.expiresAt?.toISOString() ?? null,
  revokedAt: invite.revokedAt?.toISOString() ?? null,
  state: { useCount: invite.state.useCount, lastUsedAt: invite.state.lastUsedAt?.toISOString() ?? null },
  createdAt: invite.createdAt.toISOString(),
});
