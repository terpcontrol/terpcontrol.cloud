import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceFirmware, FirmwareChannel } from '@fg2/shared-types/v1';
import { useDeviceFirmwares, useDevices, useUpdateDevice } from '@/api/devices';
import { Sheet } from '@/ui/Sheet';
import { SettingRow } from '@/ui/advanced/SettingRow';
import { advancedItem, type DeviceContext } from '@/ui/advanced/item';
import { Refused } from '@/ui/PageState';
import { Choice, Choices, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { calendarDay, useZone } from '@/ui/zone';
import { buildLabel, deviceTitle } from '@/ui/naming';
import sheet from '../Maintenance.module.css';
import { useChannel } from '../update-channel';
import styles from './DeviceAdvanced.module.css';

/**
 * Where a device's firmware comes from, as the old app offered it: a release
 * channel it updates itself from, or by hand - and then the version it is to
 * install, picked from the builds its list offers. A grower is offered every
 * build that was ever stable and everything newer than the last of those; an
 * administrator every build of the class, for a rollback or a test build.
 *
 * Choosing the manual channel changes nothing on the device: it stays on the
 * build it has until a version is installed below, which asks first because the
 * device restarts with it.
 */
const CHANNELS: readonly FirmwareChannel[] = ['stable', 'beta', 'alpha', 'manual'];

function UpdateChannel({ device, mayManage, isAdmin }: DeviceContext) {
  const { t } = useTranslation();
  const update = useChannel(device);
  const channel = update.asked ?? device.firmware.channel;

  return (
    <>
      <SettingRow label={t('updateChannel.label')} help="advanced.updateChannel" note={t(`updateChannel.note.${channel}`)} wide>
        <Choices label={t('updateChannel.label')}>
          {CHANNELS.map(one => (
            <Choice
              key={one}
              chosen={one === channel}
              disabled={!mayManage || update.isPending}
              onChoose={() => (one === channel ? undefined : update.set(one))}
            >
              {t(`updateChannel.${one}`)}
            </Choice>
          ))}
        </Choices>
      </SettingRow>
      <Refused error={update.error} />
      {channel === 'manual' && device.classId !== null ? <VersionPick device={device} mayManage={mayManage} isAdmin={isAdmin === true} /> : null}
    </>
  );
}

function VersionPick({ device, mayManage, isAdmin }: { device: Device; mayManage: boolean; isAdmin: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const firmwares = useDeviceFirmwares(device.id, true);
  const [picked, setPicked] = useState('');
  const [asking, setAsking] = useState(false);
  const builds = [...(firmwares.data?.items ?? [])].sort((one, other) => other.createdAt.localeCompare(one.createdAt));
  const build = builds.find(one => one.id === picked) ?? null;
  // Two builds stamped alike are told apart by their ids, as the old list did.
  const stamped = new Map<string, number>();
  for (const one of builds) stamped.set(buildName(one), (stamped.get(buildName(one)) ?? 0) + 1);

  const label = (one: DeviceFirmware) =>
    [
      (stamped.get(buildName(one)) ?? 0) > 1 ? `${buildName(one)} (${one.id.slice(0, 8)})` : buildName(one),
      calendarDay(one.createdAt, zone),
      one.id === device.state.firmwareId ? t('firmwarePin.running') : null,
      one.channels.length > 0
        ? t('firmwarePin.current', { channels: one.channels.map(channel => t(`updateChannel.${channel}`)).join(', ') })
        : one.wasStable
          ? t('firmwarePin.wasStable')
          : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <SettingRow
        label={t('firmwarePin.label')}
        help="advanced.firmwarePin"
        note={firmwares.isError ? t('devices.buildUnread') : t(isAdmin ? 'firmwarePin.noteAdmin' : 'firmwarePin.note')}
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

function PinSheet({ device, build, onClose }: { device: Device; build: DeviceFirmware; onClose: () => void }) {
  const { t } = useTranslation();
  const devices = useDevices();
  const pin = useUpdateDevice(device.id);
  const name = deviceTitle(device, t, devices.data?.items);

  return (
    <Sheet
      title={t('firmwarePin.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={pin.isSuccess} error={pin.error} onClose={onClose}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={pin.isPending}
            onClick={() => pin.mutate({ firmware: { channel: 'manual', targetId: build.id } })}
          >
            {t('firmwarePin.yes')}
          </button>
        </SheetAnswer>
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
const buildName = (build: DeviceFirmware): string => buildLabel(build) ?? build.id.slice(0, 8);

export const items = [
  advancedItem({
    scope: 'device',
    id: 'update-channel',
    order: 900,
    shows: ({ device, mayManage }) => mayManage && !device.isDemo,
    Item: UpdateChannel,
  }),
];
