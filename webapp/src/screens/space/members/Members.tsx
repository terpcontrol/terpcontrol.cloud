import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SHARE_LINKS } from '@/app/places';
import type { SpaceKind } from '@fg2/shared-types/v1';
import { useCameras } from '@/api/cameras';
import { useDiaryLayer } from '@/api/layers';
import { useMembers } from '@/api/members';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { initials } from '@/ui/handle';
import { ageLabel } from '@/ui/age';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { ownsCamera } from '@/screens/devices/cameras';
import { useDevices } from '@/api/devices';
import { InviteBlock } from './InviteBlock';
import { guestsOf, lastLoggedOf, personOf, viaRoomCount } from './people';
import { Permissions } from './Permissions';
import { PersonRow } from './PersonRow';
import { type Leaving, RemoveSheet } from './RemoveSheet';
import styles from './Members.module.css';

/**
 * Who is in a place - or in a room, with every place in it - and the two ways
 * to put somebody else in it: the section "Wer … sieht" of "Ort bearbeiten",
 * and the page a member without the right to manage is shown instead.
 *
 * A place can be shared on its own, or the room it stands in can be shared and
 * then every place grouped under it comes with it - which is why a row that
 * arrived through the room is drawn here and changed there. Which of the two
 * the list is about is chosen above it ("Einladung gilt für").
 *
 * Handing out the way in is the owner's alone. A member sees the same list,
 * because somebody who cannot tell who else is here cannot tell whose entry
 * they are reading, and sees no control on it except the one that lets them
 * leave. The demo owns nothing and is told so rather than shown a list the
 * server will not answer.
 */
export function Members({
  spaceId,
  name,
  kind,
  roomId,
  scope = null,
}: {
  spaceId: string;
  name: string;
  kind: SpaceKind;
  roomId: string | null;
  /** The choice of what an invitation is for - this place or its room - which stands as the card's last row. */
  scope?: ReactNode;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const spaces = useSpaces();
  const members = useMembers(spaceId, !isDemo);
  // Everything this screen writes - a key, a role, showing somebody the door -
  // is `own` on the space, which is the one need a manager does not have.
  const mayWrite = useMayIn(spaceId, 'own');
  // Both of these belong to the screen rather than to a row: the row is the
  // first thing a removal takes away, and it would carry the question and what
  // is to be said about the answer off the page with it.
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [inviting, setInviting] = useState(false);
  const [stoppedLink, setStoppedLink] = useState<{ code: string; name: string } | null>(null);
  // What there is to see and write here, so the table promises neither grows
  // nor entries to somebody who keeps no diary, nor cameras to somebody who
  // has none: a camera counts once the account's cameras have answered.
  const diary = useDiaryLayer();
  const cameras = useCameras();
  const hasCamera = cameras.data !== undefined && ownsCamera(cameras.data.items);
  const devices = useDevices();
  const steering = devices.data?.items === undefined || devices.data.items.length > 0;

  if (isDemo) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.members.demo')}</p>;
  if (members.isPending) return <Waiting lines={4} />;
  if (!members.data) return <LoadFailed retry={() => void members.refetch()} />;

  const page = members.data;
  const listed = spaces.data?.items ?? [];
  // The room is in the space list only for somebody who is in the room as well;
  // a member of this place alone knows it by the name the answer carries.
  const roomName = listed.find(one => one.id === roomId)?.name ?? page.room?.name ?? null;
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

      <ul className={ui.group}>
        <OwnerRow isYou={isYou} handle={ownerHandle} name={name} lastLogged={ownerId ? lastLoggedOf(page, ownerId) : null} diary={diary} />
        {guestsOf(page, spaceId).map(guest => (
          <PersonRow
            key={guest.userId}
            spaceId={spaceId}
            guest={guest}
            handle={personOf(page, guest.userId)?.handle ?? null}
            roomName={roomName}
            lastLogged={lastLoggedOf(page, guest.userId)}
            diary={diary}
            isYou={guest.userId === user?.id}
            mayManage={mayWrite}
            now={now}
            onAskToRemove={setLeaving}
          />
        ))}
        {mayWrite ? (
          <li>
            <button
              type="button"
              className={styles.invite}
              aria-expanded={inviting}
              aria-controls={`${spaceId}-invite`}
              onClick={() => setInviting(!inviting)}
            >
              + {t('space.members.inviteSomebody')}
            </button>
          </li>
        ) : null}
        {scope ? <li>{scope}</li> : null}
      </ul>
      {viaRoom > 0 ? <p className={ui.note}>{t('space.members.viaTheRoom', { count: viaRoom })}</p> : null}

      {/* The links, the name field and what each role may do: opened by the row above, by whoever hands out the way in. */}
      {mayWrite && inviting ? (
        <div id={`${spaceId}-invite`} className={styles.inviting}>
          <InviteBlock spaceId={spaceId} spaceName={name} kind={kind} />
          <Permissions kind={kind} diary={diary} cameras={hasCamera} steering={steering} />
          {/* Sharing is two things: letting somebody in, above, and letting somebody look without an account, which is a link. */}
          <p className={ui.note}>
            {t('place.members.lookOnly')}{' '}
            <Link to={SHARE_LINKS} className={styles.shareLink}>
              {t('place.members.shareLink')} ›
            </Link>
          </p>
        </div>
      ) : null}
      {/*
        The removal that revoked it has already happened, so this is a report
        and not a warning: without it the live link simply vanishes from the
        block above and a host is left to work out which of the two taps did it.
      */}
      {stoppedLink ? (
        <p className={`mono ${styles.linkStopped}`} role="status">
          {t('space.members.linkStopped', stoppedLink)}
        </p>
      ) : null}
      {/* A member has no links to hand out and is still owed what their role lets them do. */}
      {mayWrite ? null : <Permissions kind={kind} diary={diary} cameras={hasCamera} steering={steering} />}

      {leaving ? (
        <RemoveSheet
          spaceId={spaceId}
          leaving={leaving}
          now={now}
          onClose={() => setLeaving(null)}
          onLinkStopped={code => setStoppedLink({ code, name: leaving.name })}
        />
      ) : null}
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
 *
 * When they last logged is a diary's fact, and without the diary there is
 * nothing anybody logs - so the line then says whose place it is and no more.
 */
function OwnerRow({
  isYou,
  handle,
  name,
  lastLogged,
  diary,
}: {
  isYou: boolean;
  handle: string | null;
  name: string;
  lastLogged: string | null;
  diary: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();

  return (
    <li className={`${ui.card} ${styles.person}`}>
      <span className={`mono ${styles.avatar}`} aria-hidden>
        {handle ? initials(handle) : '·'}
      </span>
      <span className={styles.who}>
        <span className={styles.handle}>{isYou ? t('space.members.you') : handle ? `@${handle}` : t('space.members.theOwner')}</span>
        <span className={`mono ${ui.dots} ${styles.how}`}>
          <span className={styles.howProse}>{t('space.members.owns', { name })}</span>
          {/*
            The owner writes in their own tent like anybody else, and a list
            that dated every guest's last entry but not theirs would read as if
            the person who runs the place never touched it.
          */}
          {diary ? (
            <span className={styles.howFigure}>
              {' · '}
              {lastLogged === null ? t('space.members.neverLogged') : t('space.members.lastLogged', { age: ageLabel(lastLogged, now) })}
            </span>
          ) : null}
        </span>
      </span>
      <span className={ui.chip}>{t('space.members.role.owner')}</span>
    </li>
  );
}
