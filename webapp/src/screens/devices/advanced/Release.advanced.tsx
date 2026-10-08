import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevices, useReleaseDevice } from '@/api/devices';
import { useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { deviceTitle } from '../naming';
import sheet from '../Maintenance.module.css';
import styles from './DeviceAdvanced.module.css';

/**
 * Giving a device up: after a sale, a move to another account or a swap, the
 * hardware leaves this account and whoever holds it next adds it with the
 * code its display shows. Without it a used device stays locked to its first
 * owner for good.
 *
 * It is the owner's alone and the last line of the section, and it is asked
 * twice, with two different buttons: what goes with the device and what stays,
 * then whether it is meant - because it cannot be taken back from here.
 */
function Release({ device }: DeviceContext) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <SettingRow label={t('release.label')} help="advanced.release" note={t('release.note')}>
        <button type="button" className={`${ui.chip} ${styles.danger}`} onClick={() => setAsking(true)}>
          {t('release.open')}
        </button>
      </SettingRow>
      {asking ? <ReleaseSheet deviceId={device.id} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function ReleaseSheet({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
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
  // with the sheet, so the panel the question stood in goes with it.
  const done = () => {
    onClose();
    forget();
  };

  const actions =
    sure || release.isSuccess ? (
      <SheetAnswer done={release.isSuccess} error={release.error} onClose={onClose} onDone={done}>
        <button type="button" className={styles.dangerButton} disabled={release.isPending} onClick={() => release.mutate()}>
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
      <div className={sheet.body} role={release.isSuccess ? 'status' : undefined}>
        {release.isSuccess ? (
          <p>{t('release.done', { name })}</p>
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

export const items = [
  advancedItem({
    scope: 'device',
    id: 'release',
    // Always the last line: the one thing in the section that cannot be undone.
    order: 1000,
    shows: ({ device, mayOwn }) => mayOwn === true && !device.isDemo,
    Item: Release,
  }),
];
