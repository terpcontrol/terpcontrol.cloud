import 'reflect-metadata';
import { InvitesController, SpaceInvitesController } from '@modules/v1/members/invites.controller';
import { MembersController } from '@modules/v1/members/members.controller';

/**
 * What the sharing routes declare, which is the whole of what a membership is
 * allowed to widen. The need is asserted per route rather than inferred from a
 * guard being present, because a route that declares nothing is decided by
 * nothing and looks exactly like one that is decided correctly.
 */

const needOf = (controller: object, method: string): unknown =>
  Reflect.getMetadata('v1:access', (controller as { prototype: Record<string, object> }).prototype[method]);

describe('who may do what with the people in a space', () => {
  it.each([
    ['list', 'view'],
    ['add', 'own'],
    ['update', 'own'],
    ['remove', 'view'],
  ])('asks for %s to be a %s of the space', (route, need) => {
    expect(needOf(MembersController, route)).toEqual({ need, subject: 'space', param: 'id' });
  });

  /**
   * Reading and removing both ask for less than what they finally allow, and
   * both make up the difference themselves: the list is answered only to a
   * grant that says the caller is really in the space, and removing anybody but
   * oneself is held to `own`. Stated here so that the two lines above are not
   * read as this round having forgotten them.
   */
  it('leaves the rest of the list and the removal to the service', () => {
    expect(needOf(MembersController, 'list')).toEqual(needOf(MembersController, 'remove'));
  });

  it.each([
    ['list', 'own'],
    ['create', 'own'],
  ])('asks for %s to be an owner of the space it invites into', (route, need) => {
    expect(needOf(SpaceInvitesController, route)).toEqual({ need, subject: 'space', param: 'id' });
  });

  /**
   * The routes addressed by a code declare nothing, and must not: the subject is
   * inside the invite and is only known once it has been read, so the service
   * asks `access()` about the space itself.
   */
  it.each(['preview', 'accept', 'revoke', 'remove'])('leaves %s undeclared, because a code names no space until it is read', route => {
    expect(needOf(InvitesController, route)).toBeUndefined();
  });
});
