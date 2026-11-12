import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { membersPath } from '@/app/places';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { useMayInSpace, useMayManage } from '@/ui/session-access';
import { RenameSheet } from '@/screens/place/RenameSheet';
import { DeviceHereSheet } from '@/screens/space/DeviceHereSheet';
import { useDevicesElsewhere } from '@/screens/space/devices-elsewhere';
import { RoomSheet } from '@/screens/space/members/RoomSheet';
import { RemovePlaceSheet } from '@/screens/space/RemovePlaceSheet';
import styles from './Start.module.css';

type Sheet = 'rename' | 'device' | 'room' | 'remove';

/**
 * What is done to a place now and then rather than every day, behind the ⋯
 * beside its name - a button that says so in words on a desktop: its name,
 * the room it stands in, who else is let in, the devices standing in it, and
 * its end. None of it is a reading, so none of it takes room on Start itself.
 * Everything that changes the place needs the right to manage it; who is let
 * in can be read by every member, who may leave from there.
 */
export function PlaceMenu({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const mayManage = useMayManage(overview.spaceId);
  const member = useMayInSpace(overview.spaceId) !== undefined;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const listId = useId();
  // A place holds any number of devices; bringing one in is offered wherever one stands somewhere else.
  const mayBringDevice = useDevicesElsewhere(overview.spaceId, mayManage).length > 0 && mayManage;
  // Rooms come with a second place, and are the owner's: a room and the places in it belong to one account.
  const spaces = useSpaces(mayManage);
  const listed = spaces.data?.items ?? [];
  const room = listed.find(one => one.id === overview.roomId) ?? null;
  const navigate = useNavigate();
  const owns = user !== null && listed.some(one => one.id === overview.spaceId && one.ownerId === user.id);
  // Ending a place is its owner's, and never the last one: that one is Start itself.
  const mayRemove =
    owns && overview.kind !== 'room' && listed.some(one => one.id !== overview.spaceId && one.kind !== 'room' && one.archivedAt === null);
  const mayRoom =
    overview.kind !== 'room' &&
    user !== null &&
    listed.some(one => one.id === overview.spaceId && one.ownerId === user.id) &&
    listed.filter(one => one.kind !== 'room' && one.archivedAt === null).length > 1;
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const choose = (next: Sheet) => {
    setOpen(false);
    setSheet(next);
  };

  return (
    <div className={styles.menu} ref={frame}>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('start.menu.label', { name: overview.name })}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
        <span className={styles.menuWords} aria-hidden>
          {t('start.menu.label', { name: overview.name })}
        </span>
      </button>
      {open ? (
        <div className={styles.menuList} id={listId}>
          {mayManage ? (
            <button type="button" onClick={() => choose('rename')}>
              {t('cockpit.menu.rename')}
            </button>
          ) : null}
          {mayRoom ? (
            <button type="button" onClick={() => choose('room')}>
              {room ? t('cockpit.menu.room') : t('cockpit.menu.putInRoom')}
              {room ? (
                <>
                  {' '}
                  <span className={styles.menuLine}>{t('space.members.room.in', { room: room.name })}</span>
                </>
              ) : null}
            </button>
          ) : null}
          {/* Who else is here is a member's question; support reading a customer's place is not one. */}
          {member ? (
            <Link to={membersPath(overview.spaceId)} onClick={() => setOpen(false)}>
              {t('cockpit.menu.members')}
            </Link>
          ) : null}
          {mayBringDevice ? (
            <button type="button" onClick={() => choose('device')}>
              {t('cockpit.menu.deviceHere')}
            </button>
          ) : null}
          {mayRemove ? (
            <button type="button" onClick={() => choose('remove')}>
              {t('cockpit.menu.remove')}
            </button>
          ) : null}
        </div>
      ) : null}
      {sheet === 'remove' ? <RemovePlaceSheet overview={overview} onClose={() => setSheet(null)} onRemoved={() => void navigate('/')} /> : null}
      {sheet === 'rename' ? <RenameSheet spaceId={overview.spaceId} name={overview.name} onClose={() => setSheet(null)} /> : null}
      {sheet === 'room' ? (
        <RoomSheet
          spaceId={overview.spaceId}
          spaceName={overview.name}
          roomId={overview.roomId}
          roomName={room?.name ?? null}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'device' ? <DeviceHereSheet spaceId={overview.spaceId} spaceName={overview.name} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
