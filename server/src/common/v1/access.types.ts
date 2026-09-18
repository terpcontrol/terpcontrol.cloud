/**
 * What every request of `/v1` is decided by. The decision itself is
 * `AccessService.access`; these are the three things it is asked about and the
 * one thing it answers.
 */

/**
 * What a route wants to do, from the widest to the narrowest. They are not a
 * ladder the code walks - each is named by the routes that need it - but `own`
 * implies the rest, `manage` implies `log` and `view`, and `log` implies `view`.
 *
 * - `own`: claim and unclaim, delete a space, grow or camera, members, invites,
 *   share links, entitlement.
 * - `manage`: configuration, alarm rules, plan, commands, sockets, camera
 *   settings, other people's entries.
 * - `log`: write entries, upload photos, complete tasks, start a visit, edit
 *   one's own entries.
 * - `view`: every read.
 */
export type Need = 'own' | 'manage' | 'log' | 'view';

/** Everything a request can be about. Each resolves to the same handful of facts. */
export type SubjectType = 'device' | 'space' | 'grow' | 'plant' | 'camera' | 'entry' | 'media';

export interface SubjectRef {
  type: SubjectType;
  id: string;
}

/**
 * Who is asking. A request carries at most one identity: a session, or a share
 * token, or neither - a public page is read by nobody in particular.
 */
export interface AccessContext {
  userId: string | null;
  isAdmin: boolean;
  isDemo: boolean;
  /** The secret of a share link the request came in on, never an id. */
  shareToken: string | null;
}

/** A window a read is clamped to. A null end is open. */
export interface AccessRange {
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Why the request is allowed, which is also how much of the answer is serialised. */
export type Grantee = 'admin' | 'owner' | 'member' | 'demo' | 'public' | 'share';

/**
 * A yes, with everything the answer has to be built by: the window every read
 * clamps to, whose privacy settings a serialiser applies, and whether pictures
 * of a camera may be part of the answer at all.
 */
export interface Grant {
  need: Need;
  subject: SubjectRef;
  grantee: Grantee;
  range: AccessRange;
  /**
   * Whose privacy settings decide what is stripped - the owner of the thing
   * being read, never the reader.
   */
  privacyOwnerId: string | null;
  /**
   * Whether harvest weights, and plant counts when that setting is on, have to
   * go. False for the owner and the people they share the space with, who are
   * looking at their own grow.
   */
  redacted: boolean;
  /** Camera pictures are only ever part of an answer through a link that includes them. */
  includeCameras: boolean;
}

/**
 * The facts a subject is decided by, whatever it is. Resolving each type down to
 * this is what lets one function decide every request.
 */
export interface ResolvedSubject {
  ref: SubjectRef;
  /** Null for a device nobody has claimed, which is then nobody's but an admin's. */
  ownerId: string | null;
  isDemo: boolean;
  isPublic: boolean;
  /** Every space a membership could cover it through, rooms included. */
  spaceIds: string[];
  /** The grow it belongs to, which is what a share link on a grow covers. */
  growId: string | null;
  /** The life of the public grow it belongs to: what a public read is clamped to. */
  publicRange: AccessRange | null;
  /** A camera, or a picture one took. */
  ofACamera: boolean;
  /** An entry's author, who may edit their own with `log` where anyone else needs `manage`. */
  authorId: string | null;
}
