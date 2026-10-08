import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { usePutDeviceHere, useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from '@/ui/naming';
import { useDevicesElsewhere } from './devices-elsewhere';
import { EmptyPlace } from './EmptyPlace';
import styles from './MoveHereSheet.module.css';

/**
 * A device brought into this place from wherever it stands, asked from the
 * place's side: a place holds as many devices as stand in it - a controller, a
 * lamp, a fan - and the one each of them was first put in is only where its
 * claim or the old cloud happened to leave it.
 *
 * It is written on the tap, as the device's own picker writes it. What it left
 * behind is said afterwards, and a place left with nothing in it is offered for
 * removal rather than removed.
 */
export function DeviceHereSheet({ spaceId, spaceName, onClose }: { spaceId: string; spaceName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useDevices().data?.items;
  const elsewhere = useDevicesElsewhere(spaceId);
  const spaces = useSpaces().data?.items ?? [];
  const put = usePutDeviceHere(spaceId);
  const [moved, setMoved] = useState<{ title: string; from: string | null } | null>(null);

  const placeOf = (device: Device) => spaces.find(space => space.id === device.spaceId)?.name ?? t('claim.place.unknown');

  return (
    <Sheet title={t('space.deviceHere.title', { name: spaceName })} onClose={onClose}>
      <div className={ui.sheetBody}>
        {moved ? (
          <>
            <p className={ui.note} role="status">
              {t('space.deviceHere.moved', { device: moved.title, place: spaceName })}
            </p>
            {moved.from ? <EmptyPlace spaceId={moved.from} /> : null}
          </>
        ) : null}

        <Block label={t('space.deviceHere.which')}>
          {elsewhere.length === 0 ? (
            <p className={ui.note}>{t('space.deviceHere.none')}</p>
          ) : (
            <Choices label={t('space.deviceHere.which')}>
              {elsewhere.map(device => (
                <Choice
                  key={device.id}
                  chosen={false}
                  disabled={put.isPending}
                  onChoose={() =>
                    put.mutate(device.id, {
                      onSuccess: () => setMoved({ title: deviceTitle(device, t, devices), from: device.spaceId }),
                    })
                  }
                >
                  {deviceTitle(device, t, devices)} · {placeOf(device)}
                </Choice>
              ))}
            </Choices>
          )}
        </Block>

        <p className={ui.note}>{t('space.deviceHere.note')}</p>
        <Refused error={put.error} />

        <button type="button" className={`${ui.button} ${styles.submit}`} onClick={onClose}>
          {t('space.deviceHere.done')}
        </button>
      </div>
    </Sheet>
  );
}
