import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceKind } from '@fg2/shared-types/v1';
import { useMembers } from '@/api/members';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { initials } from '@/app/shell/tabs';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteBlock } from './InviteBlock';
import { guestsOf, lastLoggedOf, peopleCount, personOf, viaRoomCount } from './people';
import { Permissions } from './Permissions';
import { PersonRow } from './PersonRow';
import styles from './Members.module.css';

/**
 * The Members tab: who is in this tent, and the two ways to put somebody else
 * in it.
 *
 * There is one model on this screen and the switch at the top is it. A tent can
 * be shared on its own, or the room it stands in can be shared and then every
 * tent grouped under it comes with it - which is why a row that arrived through
 * the room is drawn here and changed there, and why the switch is an address
 * rather than a mode: the room's member list is the room's page.
 *
 * Handing out the way in is the owner's alone. A member sees the same list,
 * because somebody who cannot tell who else is here cannot tell whose entry
 * they are reading, and sees no control on it except the one that lets them
 * leave. The demo owns nothing and is told so rather than shown a list the
 * server will not answer.
 */
export function Members({ spaceId, name, kind, roomId }: { spaceId: string; name: string; kind: SpaceKind; roomId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const spaces = useSpaces();
  const members = useMembers(spaceId, !isDemo);
  const mayWrite = useMayManage();

  if (isDemo) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.members.demo')}</p>;
  if (members.isPending) return <Waiting lines={4} />;
  if (!members.data) return <LoadFailed retry={() => void members.refetch()} />;

  const page = members.data;
  // The room is in the space list only for somebody who is in the room as well;
  // a member of this tent alone knows it by the name the answer carries, and
  // has nothing there to switch to.
  const room = (spaces.data?.items ?? []).find(one => one.id === roomId) ?? null;
  const roomName = room?.name ?? page.room?.name ?? null;
  const tents = (spaces.data?.items ?? []).filter(one => one.roomId === roomId && one.archivedAt === null).length;
  // Handing out the way in takes `own`, not `can_manage`, so the question here
  // is ownership rather than the role - a manager runs the tent and running it
  // is the one thing that does not include giving away a key to it.
  const ownerId = spaces.data?.items.find(one => one.id === spaceId)?.ownerId ?? null;
  const isOwner = mayWrite && ownerId !== null && ownerId === user?.id;
  // The owner is named the way everybody else is, out of `people`, which the
  // server fills for the rows and for the owner. Until an answer names them,
  // the one person who can still be named is the reader.
  const ownerHandle = (ownerId ? personOf(page, ownerId)?.handle : null) ?? (isOwner ? (user?.handle ?? null) : null);
  const viaRoom = viaRoomCount(page, spaceId);

  return (
    <section className={styles.tab}>
      <RefreshFailed failedAt={members.isError ? members.dataUpdatedAt : null} now={now} />

      {room ? (
        <nav className={styles.scope} aria-label={t('space.members.scopeLabel')}>
          <span className={`${styles.scopeOption} ${styles.scopeHere}`} aria-current="page">
            {name}
          </span>
          <Link to={`/spaces/${room.id}/members`} className={styles.scopeOption}>
            {t('space.members.roomWithTents', { room: room.name, count: tents })}
          </Link>
        </nav>
      ) : null}
      <p className={ui.note}>{t('space.members.oneModel')}</p>

      {isOwner ? <InviteBlock spaceId={spaceId} spaceName={name} kind={kind} /> : null}

      <header className={styles.peopleHead}>
        <span className="label">{t('space.members.peopleIn', { name })}</span>
        <span className={`mono ${styles.count}`}>
          {peopleCount(page)}
          {viaRoom > 0 ? ` · ${t('space.members.viaTheRoom', { count: viaRoom })}` : ''}
        </span>
      </header>

      <ul className={styles.people}>
        <OwnerRow isYou={isOwner} handle={ownerHandle} name={name} />
        {guestsOf(page, spaceId).map(guest => (
          <PersonRow
            key={guest.userId}
            spaceId={spaceId}
            guest={guest}
            handle={personOf(page, guest.userId)?.handle ?? null}
            roomName={roomName}
            lastLogged={lastLoggedOf(page, guest.userId)}
            isYou={guest.userId === user?.id}
            mayManage={isOwner}
            now={now}
          />
        ))}
      </ul>

      <Permissions />
    </section>
  );
}

/**
 * The owner, who is the space's `ownerId` and never a membership row - so there
 * is nothing to change here and no menu to change it with.
 *
 * They are named all the same, because a list on which every guest carries a
 * handle and the one person who runs the tent is a dot fails at the reason a
 * member is shown the list at all: telling whose entry they are reading. What
 * is said under the name is that they own the place, which is a fact about the
 * tent rather than a role in it.
 */
function OwnerRow({ isYou, handle, name }: { isYou: boolean; handle: string | null; name: string }) {
  const { t } = useTranslation();

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {handle ? initials(handle) : '·'}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : handle ? `@${handle}` : t('space.members.theOwner')}</span>
        <span className={`mono ${styles.how}`}>
          <span className={styles.howProse}>{t('space.members.owns', { name })}</span>
        </span>
      </span>
      <span className={ui.chip}>{t('space.members.role.owner')}</span>
    </li>
  );
}
