import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Firmware } from '@fg2/shared-types/v1';
import { useDeviceFirmwares, useDevices, useUpdateDevice } from '@/api/devices';
import { Sheet } from '@/log/Sheet';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone } from '@/ui/zone';
import { deviceTitle } from '../naming';
import sheet from '../Maintenance.module.css';
import styles from './DeviceAdvanced.module.css';

/**
 * Putting one device on a particular build: a rollback after a release that
 * went wrong for it, or a test build for one customer. It is the operator's
 * tool and the server takes it from nobody else, so it is drawn for an
 * administrator only.
 *
 * A pinned device stays where it was put: the switch for automatic updates
 * goes off with it, because a channel would move the device on again at the
 * next release.
 */
function FirmwarePin({ device, mayManage }: DeviceContext) {
  const { t } = useTranslation();
  const zone = useZone();
  const firmwares = useDeviceFirmwares(device.id, true);
  const [picked, setPicked] = useState('');
  const [asking, setAsking] = useState(false);
  const builds = [...(firmwares.data?.items ?? [])].sort((one, other) => other.createdAt.localeCompare(one.createdAt));
  const build = builds.find(one => one.id === picked) ?? null;

  const label = (one: Firmware) =>
    [
      buildName(one),
      calendarDay(one.createdAt, zone),
      one.id === device.state.firmwareId ? t('firmwarePin.running') : null,
      one.wasStable ? t('firmwarePin.wasStable') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <SettingRow
        label={t('firmwarePin.label')}
        help="advanced.firmwarePin"
        note={firmwares.isError ? t('devices.buildUnread') : t('firmwarePin.note')}
        wide
      >
        <span className={styles.inline}>
          <select
            className={`${ui.input} ${styles.select}`}
            aria-label={t('firmwarePin.label')}
            value={picked}
            disabled={!mayManage || builds.length === 0}
            onChange={event => setPicked(event.target.value)}
          >
            <option value="">{t(firmwares.isPending ? 'home.waiting' : builds.length === 0 ? 'firmwarePin.none' : 'firmwarePin.pick')}</option>
            {builds.map(one => (
              <option key={one.id} value={one.id}>
                {label(one)}
              </option>
            ))}
          </select>
          <button type="button" className={ui.chip} disabled={!build || build.id === device.state.firmwareId} onClick={() => setAsking(true)}>
            {t('firmwarePin.install')}
          </button>
        </span>
      </SettingRow>
      {asking && build ? <PinSheet device={device} build={build} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function PinSheet({ device, build, onClose }: { device: Device; build: Firmware; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const pin = useUpdateDevice(device.id);
  const name = deviceTitle(device, t, devices.data?.items);

  return (
    <Sheet
      title={t('firmwarePin.title', { name })}
      onClose={onClose}
      actions={
        pin.isSuccess ? (
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
            {t('maintenance.done')}
          </button>
        ) : (
          <>
            <Refused error={pin.error} />
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={pin.isPending}
              onClick={() => pin.mutate({ firmware: { channel: 'manual', targetId: build.id } })}
            >
              {t('firmwarePin.yes')}
            </button>
            <button type="button" className={ui.button} onClick={onClose}>
              {t('maintenance.cancel')}
            </button>
          </>
        )
      }
    >
      <div className={sheet.body} role={pin.isSuccess ? 'status' : undefined}>
        {pin.isSuccess ? (
          <p>{t('firmwarePin.sent', { name, build: buildName(build) })}</p>
        ) : (
          <>
            <p>{t('firmwarePin.what', { name, build: buildName(build) })}</p>
            <p className={ui.note}>{t('firmwarePin.restart')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A build by what its container stamped it with, which is the one thing that tells two builds of one class apart. */
const buildName = (build: Firmware): string => build.version || build.name || build.id.slice(0, 8);

export const items = [
  advancedItem({
    scope: 'device',
    id: 'firmware-pin',
    order: 910,
    shows: ({ device, mayManage, isAdmin }) => isAdmin === true && mayManage && device.classId !== null && !device.isDemo,
    Item: FirmwarePin,
  }),
];
