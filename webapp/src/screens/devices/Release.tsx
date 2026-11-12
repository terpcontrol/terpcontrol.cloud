import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevices, useReleaseDevice } from '@/api/devices';
import { useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { Answered, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from '@/ui/naming';
import sheet from './Maintenance.module.css';

/**
 * Giving a device up: after a sale, a move to another account or a swap, the
 * hardware leaves this account and whoever holds it next adds it with the
 * code its display shows. Without it a used device stays locked to its first
 * owner for good.
 *
 * It is the owner's alone and the last row of the device's page, and it is
 * asked twice, with two different buttons: what goes with the device and what
 * stays, then whether it is meant - because it cannot be taken back from here.
 */
export function ReleaseSheet({ deviceId, onClose, onReleased }: { deviceId: string; onClose: () => void; onReleased: () => void }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const spaces = useSpaces();
  const { release, forget } = useReleaseDevice(deviceId);
  const [sure, setSure] = useState(false);
  const device = devices.data?.items.find(one => one.id === deviceId);
  if (!device) return null;

  const name = deviceTitle(device, t, devices.data?.items);
  const place = spaces.data?.items.find(space => space.id === device.spaceId)?.name ?? null;
  // The device is still in the list while the answer is read; it is let go of
  // with the sheet, and its page with it.
  const done = () => {
    onClose();
    forget();
    onReleased();
  };

  const actions =
    sure || release.isSuccess ? (
      <SheetAnswer done={release.isSuccess} error={release.error} onClose={onClose} onDone={done}>
        <button type="button" className={ui.dangerOutline} disabled={release.isPending} onClick={() => release.mutate()}>
          {t(release.isPending ? 'release.releasing' : 'release.yes')}
        </button>
      </SheetAnswer>
    ) : (
      <>
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => setSure(true)}>
          {t('release.next')}
        </button>
        <button type="button" className={ui.button} onClick={onClose}>
          {t('maintenance.cancel')}
        </button>
      </>
    );

  return (
    <Sheet
      title={t(sure && !release.isSuccess ? 'release.sureTitle' : 'release.title', { name })}
      onClose={release.isSuccess ? done : onClose}
      actions={actions}
    >
      <div className={sheet.body}>
        {release.isSuccess ? (
          <Answered>{t('release.done', { name })}</Answered>
        ) : sure ? (
          <p>{t('release.sure', { name })}</p>
        ) : (
          <>
            <p>{t('release.what', { name })}</p>
            {/* Only a fridge module and a controller run a plan or carry a camera; the others take their alarms alone. */}
            <p>{t(device.type === 'fridge' || device.type === 'controller' ? 'release.goes' : 'release.goesAlarms')}</p>
            <p className={ui.note}>{place ? t('release.stays', { place }) : t('release.staysNowhere')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
