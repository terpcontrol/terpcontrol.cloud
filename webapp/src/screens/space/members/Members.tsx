import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMembers } from '@/api/members';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { initials } from '@/app/shell/tabs';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteBlock } from './InviteBlock';
import { peopleCount, personOf, sortedRows, viaRoomCount } from './people';
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
export function Members({ spaceId, name, roomId }: { spaceId: string; name: string; roomId: string | null }) {
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
  const isOwner = mayWrite && spaces.data?.items.some(one => one.id === spaceId && one.ownerId === user?.id) === true;
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

      {isOwner ? <InviteBlock spaceId={spaceId} /> : null}

      <header className={styles.peopleHead}>
        <span className="label">{t('space.members.peopleIn', { name })}</span>
        <span className={`mono ${styles.count}`}>
          {peopleCount(page)}
          {viaRoom > 0 ? ` · ${t('space.members.viaTheRoom', { count: viaRoom })}` : ''}
        </span>
      </header>

      <ul className={styles.people}>
        <OwnerRow isYou={isOwner} handle={isOwner ? (user?.handle ?? null) : null} />
        {sortedRows(page, spaceId).map(row => (
          <PersonRow
            key={row.id}
            spaceId={spaceId}
            row={row}
            handle={personOf(page, row.userId)?.handle ?? null}
            roomName={roomName}
            viaRoom={row.spaceId !== spaceId}
            isYou={row.userId === user?.id}
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
 * Their handle is in no part of this answer, which names only the rows. When
 * the person reading is the owner, the session knows it; when they are not, the
 * row still has to be here, because a list one person short would have the tent
 * belonging to nobody.
 */
function OwnerRow({ isYou, handle }: { isYou: boolean; handle: string | null }) {
  const { t } = useTranslation();

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {handle ? initials(handle) : '·'}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : t('space.members.theOwner')}</span>
        <span className={`mono ${styles.how}`}>{t('space.members.role.owner')}</span>
      </span>
      <span className={ui.chip}>{t('space.members.role.owner')}</span>
    </li>
  );
}
