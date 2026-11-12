import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { membersPath } from '@/app/places';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { Menu, MenuLine } from '@/ui/Menu';
import { useMayInSpace, useMayManage } from '@/ui/session-access';
import { RenameSheet } from '@/screens/place/RenameSheet';
import { DeviceHereSheet } from '@/screens/space/DeviceHereSheet';
import { useDevicesElsewhere } from '@/screens/space/devices-elsewhere';
import { RoomSheet } from '@/screens/space/members/RoomSheet';
import { RemovePlaceSheet } from '@/screens/space/RemovePlaceSheet';

type Sheet = 'rename' | 'device' | 'room' | 'remove';

/**
 * What is done to a place now and then rather than every day, behind the
 * menu beside its name: its name, the room it stands in, who else is let in,
 * the devices standing in it, and its end. None of it is a reading, so none of
 * it takes room on Start itself. Everything here needs the right to manage
 * the place, so Start draws the menu for nobody else: a member who may only
 * look or log reaches who is let in - and the way to leave - from the line
 * that says whose place it is.
 */
export function PlaceMenu({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const mayManage = useMayManage(overview.spaceId);
  const member = useMayInSpace(overview.spaceId) !== undefined;
  const [sheet, setSheet] = useState<Sheet | null>(null);
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

  return (
    <>
      {/* The button says what it is for; which place is said by the head beside it and, for a screen reader, in its name. */}
      <Menu label={t('start.menu.label', { name: overview.name })} words={t('start.menu.words')}>
        {mayManage ? (
          <button type="button" onClick={() => setSheet('rename')}>
            {t('start.menu.rename')}
          </button>
        ) : null}
        {mayRoom ? (
          <button type="button" onClick={() => setSheet('room')}>
            {room ? t('start.menu.room') : t('start.menu.putInRoom')}
            {room ? <MenuLine>{t('space.members.room.in', { room: room.name })}</MenuLine> : null}
          </button>
        ) : null}
        {/* Who else is here is a member's question; support reading a customer's place is not one. */}
        {member ? <Link to={membersPath(overview.spaceId)}>{t('start.menu.members')}</Link> : null}
        {mayBringDevice ? (
          <button type="button" onClick={() => setSheet('device')}>
            {t('start.menu.deviceHere')}
          </button>
        ) : null}
        {mayRemove ? (
          <button type="button" onClick={() => setSheet('remove')}>
            {t('start.menu.remove')}
          </button>
        ) : null}
      </Menu>
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
    </>
  );
}
