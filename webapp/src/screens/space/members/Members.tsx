import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDiaryLayer } from '@/api/layers';
import { useMembers } from '@/api/members';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { Facts } from '@/ui/Facts';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { Rows, RowText } from '@/ui/Rows';
import rows from '@/ui/Rows.module.css';
import { useMayIn } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { InviteBlock } from './InviteBlock';
import { guestsOf, lastLoggedOf, personOf } from './people';
import { PersonRow } from './PersonRow';
import { type Leaving, RemoveSheet } from './RemoveSheet';
import styles from './Members.module.css';

/**
 * Everybody who sees a place, as one list: its owner, whoever was let into
 * it, and whoever is in the room it stands in - tagged as that -, each with
 * what can be done about them. It is the section "Wer … sieht" of "Ort
 * bearbeiten", and the page a member without the right to manage is shown.
 *
 * Handing out the way in is the owner's alone: the links that are out and the
 * ways to invite stand under the list for them. A member sees the same list,
 * because somebody who cannot tell who else is here cannot tell whose entry
 * they are reading, and no control on it except the one that lets them leave.
 * The demo owns nothing and is told so rather than shown a list the server
 * will not answer.
 */
export function Members({ spaceId, name, roomId }: { spaceId: string; name: string; roomId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  const isDemo = user?.isDemo === true;
  const spaces = useSpaces();
  const members = useMembers(spaceId, !isDemo);
  // Everything this screen writes - a key, a role, showing somebody the door -
  // is `own` on the space, which is the one need a manager does not have.
  const mayWrite = useMayIn(spaceId, 'own');
  // The sheet belongs to the screen rather than to a row: the row is the first thing a removal takes away.
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [inviting, setInviting] = useState(false);
  // Without the diary there is nothing anybody logs, and no row dates when they last did.
  const diary = useDiaryLayer();

  if (isDemo) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.members.demo')}</p>;
  if (members.isPending) return <Waiting lines={4} />;
  if (!members.data) return <LoadFailed retry={() => void members.refetch()} />;

  const page = members.data;
  const listed = spaces.data?.items ?? [];
  // The room is in the space list only for somebody who is in the room as well;
  // a member of this place alone knows it by the name the answer carries.
  const roomName = listed.find(one => one.id === roomId)?.name ?? page.room?.name ?? null;
  const ownerId = listed.find(one => one.id === spaceId)?.ownerId ?? null;
  // What may be written here is the server's answer, which an administrator
  // has as well; whether the first row is you is about who you are.
  const isYou = ownerId !== null && ownerId === user?.id;
  const ownerHandle = ownerId ? personOf(page, ownerId)?.handle : null;
  // On one line, as facts side by side: who it is, and that they manage the place.
  const owner = isYou ? t('space.members.you') : ownerHandle ? `@${ownerHandle}` : t('space.members.theOwner');
  const owns = <span className={styles.owns}>{t(isYou ? 'space.members.youOwn' : 'space.members.owns')}</span>;
  const invitesId = `${spaceId}-invite`;

  return (
    <section className={ui.stack3}>
      <RefreshFailed failedAt={members.isError ? members.dataUpdatedAt : null} now={now} />

      <Rows>
        {/* The owner is the space's `ownerId` and never a membership row: there is nothing to change here. */}
        <div className={styles.person}>
          <RowText title={<Facts facts={[owner, owns]} />} />
        </div>
        {guestsOf(page, spaceId).map(guest => (
          <PersonRow
            key={guest.userId}
            place={{ id: spaceId, name }}
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
          <button type="button" className={rows.add} aria-expanded={inviting} aria-controls={invitesId} onClick={() => setInviting(!inviting)}>
            + {t('space.members.inviteSomebody')}
          </button>
        ) : null}
      </Rows>

      {mayWrite ? (
        <InviteBlock id={invitesId} place={{ id: spaceId, name }} room={roomId && roomName ? { id: roomId, name: roomName } : null} open={inviting} />
      ) : null}

      {leaving ? <RemoveSheet leaving={leaving} now={now} onClose={() => setLeaving(null)} /> : null}
    </section>
  );
}
