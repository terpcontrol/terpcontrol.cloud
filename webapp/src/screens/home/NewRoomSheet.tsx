import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/api/session';
import { useMakeRoom, useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';

/**
 * A room made from Start, with the places it gathers chosen in the same sheet.
 *
 * A room is where a grower's tents and fridges actually stand, and Start is
 * where they look at them side by side - so that is where a room is asked for,
 * rather than only from inside one place at a time. The places offered are the
 * account's own, because a room and the places in it belong to one account; a
 * place already in another room is offered too, named with that room, and
 * moves.
 */
export function NewRoomSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const spaces = useSpaces();
  const make = useMakeRoom();
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);

  const listed = (spaces.data?.items ?? []).filter(one => one.archivedAt === null && one.ownerId === user?.id);
  const rooms = new Map(listed.filter(one => one.kind === 'room').map(one => [one.id, one.name]));
  const places = listed.filter(one => one.kind !== 'room');
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter(one => one !== id) : [...chosen, id]);
  const ready = name.trim() !== '' && chosen.length > 0 && !make.isPending;

  return (
    <Sheet
      title={t('home.room.title')}
      onClose={onClose}
      actions={
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!ready}
          onClick={() => make.mutate({ name: name.trim(), spaceIds: chosen }, { onSuccess: onClose })}
        >
          {make.isPending ? t('home.room.making') : t('home.room.make', { count: chosen.length })}
        </button>
      }
    >
      <div className={ui.sheetBody}>
        <Block label={t('home.room.name')}>
          <input
            className={ui.input}
            value={name}
            aria-label={t('home.room.name')}
            placeholder={t('home.room.namePlaceholder')}
            autoComplete="off"
            disabled={make.isPending}
            onChange={event => setName(event.target.value)}
          />
        </Block>
        <Block label={t('home.room.places')}>
          <Choices label={t('home.room.places')}>
            {places.map(place => (
              <Choice key={place.id} chosen={chosen.includes(place.id)} disabled={make.isPending} onChoose={() => toggle(place.id)}>
                {place.roomId && rooms.has(place.roomId) ? t('home.room.inRoom', { name: place.name, room: rooms.get(place.roomId) }) : place.name}
              </Choice>
            ))}
          </Choices>
        </Block>
        <p className={ui.note}>{t('home.room.note')}</p>
        <Refused error={make.error} />
      </div>
    </Sheet>
  );
}
