import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Space } from '@fg2/shared-types/v1';
import { useUpdateDevice } from '@/api/devices';
import { useSpaces } from '@/api/spaces';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { enough } from '@/ui/session-access';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from './naming';
import styles from './DeviceSettings.module.css';

/**
 * What a device is called, and which place it stands in.
 *
 * Both are things the route has always taken and nothing in the app ever asked
 * for. The name is the worse of the two absences, because every list is built
 * around one: `naming.ts` falls back to the type and the tail of the id
 * precisely so that six unnamed controllers are not one word repeated, and a
 * fallback was all a grower could ever have. Accounts carried over from the old
 * cloud make it plainer still - a fridge that arrived called "FG2" was named
 * there, and here that name could be neither corrected nor given to the
 * hardware beside it.
 *
 * The place is the same gap from the other side. A claim has to end in some
 * space and the one it invents is a guess, so the claim flow's second step can
 * move a device; once that flow is over, nothing could, and hardware that
 * landed in the wrong tent stayed there for good. The picker here is that step's
 * picker, offered where the device is rather than where the claim was.
 *
 * The two writes behave differently on purpose. A name is typed and saved, so
 * that a half-typed word is never stored, while a place is chosen from what the
 * account already has and is written on the tap - there is nothing further to
 * say once the place has been pointed at, and a Save under a row of chips would
 * only be a second chance to forget.
 */
export function DeviceSettingsSheet({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation();
  const write = useUpdateDevice(device.id);
  const spaces = useSpaces();
  const [typed, setTyped] = useState<string | null>(null);

  // The stored name until somebody types, and the stored name again once a save
  // has gone through: what is being corrected is the server's answer, and it
  // arrives a moment after the sheet opens.
  const name = typed ?? device.name ?? '';
  const trimmed = name.trim();
  // An empty field is a device with no name of its own, which is what every
  // unclaimed one starts as: the row then carries its type and the characters
  // printed on the hardware again, rather than an empty title.
  const wanted = trimmed === '' ? null : trimmed;
  const changed = wanted !== (device.name ?? null);
  // A device is moved into a place, which is managing that place - the server
  // asks for `manage` on the destination as well as on the device - and a room
  // groups other places rather than holding hardware, so nothing stands in one.
  const elsewhere = (spaces.data?.items ?? []).filter(space => space.kind !== 'room' && enough(space.youMay, 'manage'));

  const move = (space: Space) => write.mutate({ spaceId: space.id });

  return (
    <Sheet title={t('devices.settings.title', { name: deviceTitle(device, t) })} onClose={onClose}>
      <div className={styles.body}>
        <Block label={t('devices.settings.name')}>
          <div className={ui.fieldRow}>
            <input
              className={ui.input}
              value={name}
              aria-label={t('devices.settings.name')}
              placeholder={deviceTitle(device, t)}
              autoComplete="off"
              disabled={write.isPending}
              onChange={event => setTyped(event.target.value)}
            />
            <button
              type="button"
              className={ui.fieldAction}
              disabled={!changed || write.isPending}
              onClick={() => write.mutate({ name: wanted }, { onSuccess: () => setTyped(null) })}
            >
              {write.isPending ? t('devices.settings.saving') : t('devices.settings.save')}
            </button>
          </div>
          <p className={ui.note}>{t('devices.settings.nameNote')}</p>
        </Block>

        <Block label={t('devices.settings.place')}>
          {elsewhere.length > 0 ? (
            <Choices label={t('devices.settings.place')}>
              {elsewhere.map(space => (
                <Choice key={space.id} chosen={space.id === device.spaceId} disabled={write.isPending} onChoose={() => move(space)}>
                  {space.name}
                </Choice>
              ))}
            </Choices>
          ) : (
            <p className={ui.note}>{t('devices.settings.noPlaces')}</p>
          )}
          <p className={ui.note}>{t('devices.settings.placeNote')}</p>
        </Block>

        <Refused error={write.error} />
      </div>
    </Sheet>
  );
}
