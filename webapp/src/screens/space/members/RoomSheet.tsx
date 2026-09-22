import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Space } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { useSetRoom, useSpaces } from '@/api/spaces';
import { Sheet } from '@/log/Sheet';
import { useCreateSpace } from '@/screens/grow/new/create-space';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Room.module.css';

/**
 * The room half of the sharing model, asked from the tent's side: which room
 * this tent stands in, and none if it is being taken out.
 *
 * A room is a space of kind `room` that other places are grouped under, and
 * grouping is the whole of what it is for - whoever is let into the room sees
 * every tent in it. So the sheet lives on the Members tab, where the switch
 * between the tent and its room stands once there is one, and it offers the
 * rooms this account already has and the making of a new one in the same
 * breath: a grower with no room yet is the common case, and sending them to
 * make one elsewhere first would be sending them nowhere, because nothing
 * else makes rooms.
 *
 * The rooms offered are this account's own. The server refuses a room of
 * another account, and a manager of somebody else's tent would make a room
 * under their own name and then be refused for it, so the sheet is the owner's
 * and the Members tab draws it for nobody else.
 */
export function RoomSheet({
  spaceId,
  spaceName,
  roomId,
  roomName,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  roomId: string | null;
  roomName: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const spaces = useSpaces();
  const setRoom = useSetRoom(spaceId);
  const createRoom = useCreateSpace();
  const [chosen, setChosen] = useState<string | null>(roomId);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  // The room made on this sheet, kept beside the list until the list has been
  // read again with it in, so that the button under it can name it at once.
  const [made, setMade] = useState<Space | null>(null);

  const listed = (spaces.data?.items ?? []).filter(one => one.kind === 'room' && one.archivedAt === null && one.ownerId === user?.id);
  const rooms = made && !listed.some(one => one.id === made.id) ? [...listed, made] : listed;
  const chosenRoom = rooms.find(one => one.id === chosen) ?? null;
  const ready = chosenRoom !== null && chosen !== roomId && !setRoom.isPending;

  return (
    <Sheet
      title={t('space.members.room.sheetTitle', { name: spaceName })}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={!ready}
            onClick={() => (chosenRoom ? setRoom.mutate(chosenRoom.id, { onSuccess: onClose }) : undefined)}
          >
            {setRoom.isPending
              ? t('space.members.room.moving')
              : t('space.members.room.submit', { name: spaceName, room: chosenRoom?.name ?? t('space.members.room.aRoom') })}
          </button>
          {roomId !== null ? (
            <button type="button" className={ui.button} disabled={setRoom.isPending} onClick={() => setRoom.mutate(null, { onSuccess: onClose })}>
              {t('space.members.room.takeOut', { room: roomName ?? t('space.members.theRoom') })}
            </button>
          ) : null}
        </>
      }
    >
      <div className={styles.sheetBody}>
        <Block label={t('space.members.room.which')}>
          {spaces.isPending ? <p className={ui.note}>{t('home.waiting')}</p> : null}
          {!spaces.isPending && rooms.length === 0 ? <p className={ui.note}>{t('space.members.room.none')}</p> : null}
          <Choices label={t('space.members.room.which')}>
            {rooms.map(room => (
              <Choice key={room.id} chosen={chosen === room.id} onChoose={() => setChosen(room.id)}>
                {room.name}
              </Choice>
            ))}
            <Choice chosen={naming} onChoose={() => setNaming(true)}>
              + {t('space.members.room.new')}
            </Choice>
          </Choices>

          {naming ? (
            <div className={styles.newRoom}>
              <input
                className={ui.input}
                value={name}
                aria-label={t('space.members.room.newName')}
                placeholder={t('space.members.room.newName')}
                autoComplete="off"
                onChange={event => setName(event.target.value)}
              />
              <Refused error={createRoom.error} />
              <button
                type="button"
                className={ui.button}
                disabled={createRoom.isPending || name.trim() === ''}
                onClick={() =>
                  createRoom.mutate(
                    { kind: 'room', name: name.trim() },
                    {
                      onSuccess: room => {
                        setMade(room);
                        setChosen(room.id);
                        setNaming(false);
                        setName('');
                      },
                    },
                  )
                }
              >
                {createRoom.isPending ? t('space.members.room.making') : t('space.members.room.make')}
              </button>
            </div>
          ) : null}
        </Block>

        <p className={styles.sentence}>{t('space.members.room.note')}</p>
        <Refused error={setRoom.error} />
      </div>
    </Sheet>
  );
}
