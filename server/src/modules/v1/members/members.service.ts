import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { Membership, MembershipCreate, MembershipPage, MembershipUpdate, Person } from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, forbidden, notFound } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';

/**
 * The `memberships` collection: who, besides the owner, is in a space.
 *
 * The owner is `spaces.ownerId` and never a row here, so there is no `owner`
 * role and a space nobody has been let into holds no document at all. A
 * membership on a room covers every space grouped under it, which `access()`
 * already implements for reading; the list and the writes below agree with that
 * by answering the room's rows beside the space's own and by refusing to change
 * either from the wrong end - a row on the room reaches into every tent in it,
 * so ending it from inside one of them would take somebody out of all the
 * others as a side effect of a button that named this tent.
 */
@Injectable()
export class MembersService {
  constructor(
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly access: AccessService,
  ) {}

  /**
   * Everybody in a space: its own rows and those of the room it stands in,
   * oldest first, because a member list is read in the order people arrived.
   *
   * It is answered to whoever is actually in the tent and to nobody else. `view`
   * on a space is also what a share link grants, and who else holds a key to
   * somebody's tent is not part of what a link was handed out to show - so the
   * grant has to name one of the three who belong here rather than merely say
   * yes.
   */
  public async list(spaceId: string, grant: Grant, query: PageQuery): Promise<MembershipPage> {
    const space = await this.require(spaceId);
    this.refuseAnOutsider(grant);

    const limit = pageLimit(query.limit);
    const covering = space.roomId ? [spaceId, space.roomId] : [spaceId];
    // Combined rather than merged: the cursor is an `$or` of its own, and
    // spreading it beside this filter would replace it and hand out the
    // memberships of the whole database from the second page on.
    const conditions: FilterQuery<MembershipDocument>[] = [{ spaceId: { $in: covering } }, afterCursor('createdAt', query.cursor, 'asc')];

    const rows = await this.memberships.find({ $and: conditions }).sort({ createdAt: 1, id: 1 }).limit(readLimit(limit)).lean<MembershipDocument[]>();

    const page = pageOf(rows, limit, row => ({ at: row.createdAt, id: row.id }));
    const room = space.roomId ? await this.spaces.findOne({ id: space.roomId }, { id: 1, name: 1 }).lean<Pick<SpaceDocument, 'id' | 'name'>>() : null;

    return {
      items: page.items.map(serialise),
      nextCursor: page.nextCursor,
      people: await this.peopleOf(page.items),
      // Named rather than left as an id, because somebody who is in the tent
      // alone never meets the room in any other list and would have nothing to
      // draw "via Grow room" from.
      room: room ? { id: room.id, name: room.name } : null,
    };
  }

  /**
   * Adding somebody by the name the host types. There is no directory: the
   * handle has to belong to an account this one already grows with, and every
   * other handle - including one nobody holds - is the same not-found, so that
   * the field cannot be used to ask who has an account here.
   *
   * A stranger is reached with an invite code instead, which they redeem
   * themselves. That is the difference between the two halves of the sheet:
   * being put into a tent is something the people already in it do to each
   * other, and walking into one nobody there has heard of is the guest's own
   * act.
   */
  public async add(ctx: AccessContext, spaceId: string, body: MembershipCreate): Promise<Membership> {
    const space = await this.require(spaceId);
    const person = await this.knownTo(ctx, body.handle);

    if (person.id === space.ownerId) throw conflict('owner_here', 'This account owns the space, which is more than any membership gives.');

    return this.join(spaceId, person.id, body.role, { invitedBy: this.accountOf(ctx), inviteId: null });
  }

  /**
   * Writing the row, which is also where a redeemed invite lands. The uniqueness
   * is per space and person exactly: somebody who is in the room may still be
   * given a role of their own in one tent inside it, and `access()` takes the
   * stronger of the two.
   */
  public async join(
    spaceId: string,
    userId: string,
    role: Membership['role'],
    by: { invitedBy: string | null; inviteId: string | null },
  ): Promise<Membership> {
    const existing = await this.memberships.findOne({ spaceId, userId }).lean<MembershipDocument>();
    if (existing) throw conflict('already_a_member', 'This account is already in this space.');

    const row: MembershipDocument = { id: uuidv4(), spaceId, userId, role, invitedBy: by.invitedBy, inviteId: by.inviteId, createdAt: new Date() };
    await this.memberships.create(row);

    return serialise(row);
  }

  /** The role is the only thing about a membership that changes; who it names never does. */
  public async update(spaceId: string, userId: string, body: MembershipUpdate): Promise<Membership> {
    await this.requireOwnRow(spaceId, userId);

    const changed = await this.memberships
      .findOneAndUpdate({ spaceId, userId }, { $set: { role: body.role } }, { new: true })
      .lean<MembershipDocument>();
    if (!changed) throw notFound('membership_not_found', 'Nobody by that id is a member of this space.');

    return serialise(changed);
  }

  /**
   * Letting somebody go, and leaving of one's own accord. They are the same row
   * and so they are the same route, but not the same decision: the route asks
   * the guard only for `view`, and anybody taking out a row that is not their
   * own is held to `own` here - because the point of the member list is that a
   * guest cannot quietly show a co-guest the door.
   *
   * Leaving needs nothing beyond being able to see the space. Somebody who was
   * let into a tent has to be able to walk back out of it without asking the
   * person who let them in.
   */
  public async remove(ctx: AccessContext, spaceId: string, userId: string): Promise<void> {
    await this.requireOwnRow(spaceId, userId);

    if (ctx.isDemo || userId !== ctx.userId) await this.access.require(ctx, subjectRef('space', spaceId), 'own');

    await this.memberships.deleteOne({ spaceId, userId });
  }

  /**
   * The row this space may change, which is its own and never the room's. The
   * refusal says which of the two it was, because somebody looking at a member
   * list that draws both would otherwise be told a person they can see is not
   * there.
   */
  private async requireOwnRow(spaceId: string, userId: string): Promise<MembershipDocument> {
    const row = await this.memberships.findOne({ spaceId, userId }).lean<MembershipDocument>();
    if (row) return row;

    const space = await this.require(spaceId);
    const viaRoom = space.roomId ? await this.memberships.exists({ spaceId: space.roomId, userId }) : null;

    throw viaRoom
      ? conflict('member_of_the_room', 'This account is in the room this space belongs to, and that membership is the room’s to change.')
      : notFound('membership_not_found', 'Nobody by that id is a member of this space.');
  }

  /**
   * A handle the caller already grows with: somebody who shares a space with
   * them, whichever of the two owns it. Anything else is the same refusal, a
   * handle with a public profile included - publishing a profile is consent to
   * be read, not consent to be put into somebody's tent, and a field that
   * answered differently per handle would be a way of asking who is here.
   */
  private async knownTo(ctx: AccessContext, handle: string): Promise<StoredUser> {
    const userId = this.accountOf(ctx);
    const person = await this.users.findOne({ handle, isActive: true, deletionStartedAt: null }).lean<StoredUser>();
    const unknown = notFound('handle_not_found', 'Nobody you grow with goes by that name.');
    if (!person || person.id === userId) throw unknown;

    const [mine, theirs] = await Promise.all([this.spacesOf(userId), this.spacesOf(person.id)]);
    if (![...mine].some(id => theirs.has(id))) throw unknown;

    return person;
  }

  /** Every space an account stands in, owned or joined - what "already grow with" is measured on. */
  private async spacesOf(userId: string): Promise<Set<string>> {
    const [owned, joined] = await Promise.all([
      this.spaces.find({ ownerId: userId }, { id: 1 }).lean<Pick<SpaceDocument, 'id'>[]>(),
      this.memberships.find({ userId }, { spaceId: 1 }).lean<Pick<MembershipDocument, 'spaceId'>[]>(),
    ]);

    return new Set([...owned.map(space => space.id), ...joined.map(row => row.spaceId)]);
  }

  private async peopleOf(rows: readonly MembershipDocument[]): Promise<Person[]> {
    const ids = [...new Set(rows.map(row => row.userId))];
    if (ids.length === 0) return [];

    const people = await this.users.find({ id: { $in: ids } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    return people.map(person => ({ id: person.id, handle: person.handle }));
  }

  /** A grant that says the caller is really in this space, rather than holding a key to what stands in it. */
  private refuseAnOutsider(grant: Grant): void {
    if (grant.grantee !== 'owner' && grant.grantee !== 'member' && grant.grantee !== 'admin') {
      throw notFound('space_not_found', 'There is no space with that id.');
    }
  }

  public async require(id: string): Promise<SpaceDocument> {
    const space = await this.spaces.findOne({ id }).lean<SpaceDocument>();
    if (!space) throw notFound('space_not_found', 'There is no space with that id.');

    return space;
  }

  /** A membership belongs to somebody, and a demo session is nobody. */
  public accountOf(ctx: AccessContext): string {
    if (ctx.isDemo || !ctx.userId) throw forbidden('no_account', 'This route is about an account, and a demo session is not one.');

    return ctx.userId;
  }
}

/** Field by field, because `_id` rides on a stored document and never leaves the server. */
const serialise = (row: MembershipDocument): Membership => ({
  id: row.id,
  spaceId: row.spaceId,
  userId: row.userId,
  role: row.role,
  invitedBy: row.invitedBy,
  inviteId: row.inviteId,
  createdAt: row.createdAt.toISOString(),
});
