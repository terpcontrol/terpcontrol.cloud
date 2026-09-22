import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Space, SpaceKind } from '@fg2/shared-types/v1';
import { useMembers } from '@/api/members';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { initials } from '@/app/shell/tabs';
import { ageLabel } from '@/ui/age';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteBlock } from './InviteBlock';
import { guestsOf, lastLoggedOf, peopleCount, personOf, viaRoomCount } from './people';
import { Permissions } from './Permissions';
import { PersonRow } from './PersonRow';
import { RoomSheet } from './RoomSheet';
import styles from './Members.module.css';
import roomStyles from './Room.module.css';

/**
 * The Members tab: who is in this tent, and the two ways to put somebody else
 * in it.
 *
 * There is one model on this screen and the switch at the top is it. A tent can
 * be shared on its own, or the room it stands in can be shared and then every
 * tent grouped under it comes with it - which is why a row that arrived through
 * the room is drawn here and changed there, and why the switch is an address
 * rather than a mode: the room's member list is the room's page. A tent that
 * stands in no room yet has the switch's second segment as the way to put it
 * in one, because this is the screen on which a grower first wants a room.
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
  // Everything this screen writes - a key, a role, showing somebody the door -
  // is `own` on the space, which is the one need a manager does not have.
  const mayWrite = useMayIn(spaceId, 'own');
  const [roomSheet, setRoomSheet] = useState(false);

  if (isDemo) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.members.demo')}</p>;
  if (members.isPending) return <Waiting lines={4} />;
  if (!members.data) return <LoadFailed retry={() => void members.refetch()} />;

  const page = members.data;
  const listed = spaces.data?.items ?? [];
  // The room is in the space list only for somebody who is in the room as well;
  // a member of this tent alone knows it by the name the answer carries, and
  // has nothing there to switch to.
  const room = listed.find(one => one.id === roomId) ?? null;
  const roomName = room?.name ?? page.room?.name ?? null;
  const tents = listed.filter(one => one.roomId === roomId && one.archivedAt === null).length;
  const ownerId = listed.find(one => one.id === spaceId)?.ownerId ?? null;
  // Two different questions that used to be one. What may be written here is
  // the server's answer, which an administrator has as well; whether the row at
  // the top is you is about who you are, and an administrator reading somebody
  // else's tent is not its owner.
  const isYou = ownerId !== null && ownerId === user?.id;
  // The owner is named the way everybody else is, out of `people`, which the
  // server fills for the rows and for the owner. Until an answer names them,
  // the one person who can still be named is the reader.
  const ownerHandle = (ownerId ? personOf(page, ownerId)?.handle : null) ?? (isYou ? (user?.handle ?? null) : null);
  const viaRoom = viaRoomCount(page, spaceId);

  return (
    <section className={styles.tab}>
      <RefreshFailed failedAt={members.isError ? members.dataUpdatedAt : null} now={now} />

      {kind === 'room' ? (
        <>
          <p className={ui.note}>{t('space.members.room.roomModel')}</p>
          <TentsInRoom tents={listed.filter(one => one.roomId === spaceId && one.archivedAt === null)} pending={spaces.isPending} />
        </>
      ) : (
        <>
          {room ? (
            <nav className={styles.scope} aria-label={t('space.members.scopeLabel')}>
              <span className={`${styles.scopeOption} ${styles.scopeHere}`} aria-current="page">
                {name}
              </span>
              <Link to={`/spaces/${room.id}/members`} className={styles.scopeOption}>
                {t('space.members.roomWithTents', { room: room.name, count: tents })}
              </Link>
            </nav>
          ) : mayWrite ? (
            <nav className={styles.scope} aria-label={t('space.members.scopeLabel')}>
              <span className={`${styles.scopeOption} ${styles.scopeHere}`} aria-current="page">
                {name}
              </span>
              <button type="button" className={`${styles.scopeOption} ${roomStyles.scopeAction}`} onClick={() => setRoomSheet(true)}>
                <Plus size={14} strokeWidth={2} aria-hidden />
                {t('space.members.room.put')}
              </button>
            </nav>
          ) : null}
          <p className={ui.note}>{t('space.members.oneModel')}</p>
          {room && mayWrite ? (
            <p className={`mono ${roomStyles.roomLine}`}>
              <span>{t('space.members.room.in', { room: room.name })}</span>
              <button type="button" className={ui.chip} onClick={() => setRoomSheet(true)}>
                {t('space.members.room.change')}
              </button>
            </p>
          ) : null}
        </>
      )}

      {mayWrite ? <InviteBlock spaceId={spaceId} spaceName={name} kind={kind} /> : null}

      <header className={styles.peopleHead}>
        <span className="label">{t('space.members.peopleIn', { name })}</span>
        <span className={`mono ${styles.count}`}>
          {peopleCount(page)}
          {viaRoom > 0 ? ` · ${t('space.members.viaTheRoom', { count: viaRoom })}` : ''}
        </span>
      </header>

      <ul className={styles.people}>
        <OwnerRow isYou={isYou} handle={ownerHandle} name={name} lastLogged={ownerId ? lastLoggedOf(page, ownerId) : null} />
        {guestsOf(page, spaceId).map(guest => (
          <PersonRow
            key={guest.userId}
            spaceId={spaceId}
            guest={guest}
            handle={personOf(page, guest.userId)?.handle ?? null}
            roomName={roomName}
            lastLogged={lastLoggedOf(page, guest.userId)}
            isYou={guest.userId === user?.id}
            mayManage={mayWrite}
            now={now}
          />
        ))}
      </ul>

      <Permissions kind={kind} />

      {roomSheet ? <RoomSheet spaceId={spaceId} spaceName={name} roomId={roomId} roomName={roomName} onClose={() => setRoomSheet(false)} /> : null}
    </section>
  );
}

/**
 * The tents grouped under a room, on the room's own page: the list a room's
 * member list is about. Each is a link to its own Members tab, which is where
 * a tent is put into a room or taken out of one - a room has no control for
 * that, because the pointer lives on the tent.
 */
function TentsInRoom({ tents, pending }: { tents: Space[]; pending: boolean }) {
  const { t } = useTranslation();

  if (pending) return null;
  if (tents.length === 0) return <p className={`mono ${roomStyles.roomLine}`}>{t('space.members.room.noTents')}</p>;

  return (
    <ul className={`mono ${roomStyles.tents}`} aria-label={t('space.members.room.tentsIn', { count: tents.length })}>
      <li>{t('space.members.room.tentsIn', { count: tents.length })}:</li>
      {tents.map(tent => (
        <li key={tent.id}>
          <Link to={`/spaces/${tent.id}/members`}>{tent.name}</Link>
        </li>
      ))}
    </ul>
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
function OwnerRow({ isYou, handle, name, lastLogged }: { isYou: boolean; handle: string | null; name: string; lastLogged: string | null }) {
  const { t } = useTranslation();
  const now = useNow();

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {handle ? initials(handle) : '·'}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : handle ? `@${handle}` : t('space.members.theOwner')}</span>
        <span className={`mono ${styles.how}`}>
          <span className={styles.howProse}>{t('space.members.owns', { name })}</span>
          {/*
            The owner writes in their own tent like anybody else, and a list
            that dated every guest's last entry but not theirs would read as if
            the person who runs the place never touched it.
          */}
          <span className={styles.howFigure}>
            {' · '}
            {lastLogged === null ? t('space.members.neverLogged') : t('space.members.lastLogged', { age: ageLabel(lastLogged, now) })}
          </span>
        </span>
      </span>
      <span className={ui.chip}>{t('space.members.role.owner')}</span>
    </li>
  );
}
