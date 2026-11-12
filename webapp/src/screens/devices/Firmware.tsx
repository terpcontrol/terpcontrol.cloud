import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceFirmware, FirmwareChannel } from '@fg2/shared-types/v1';
import { RELEASE_CHANNELS } from '@fg2/shared-types/v1-schemas/firmware-channels.js';
import { useDeviceFirmwares, useUpdateDevice } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { ageLabel } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, useZone } from '@/ui/zone';
import { UpdateButton } from './DeviceActions';
import { buildName, useFirmware } from './firmware-builds';
import { PinSheet } from './FirmwarePin';
import styles from './DevicePage.module.css';

/**
 * A device's firmware, on its own page: what it runs, what it owes or is
 * offered, and where its updates come from.
 *
 * The build is named by the day it was made, the one thing about it a grower
 * can compare. One switch says whether the device updates itself: on, it
 * follows a release channel chosen beside it; off (the channel `manual`), it
 * stays on its build until one is installed here, which asks first, because
 * the device restarts with it.
 *
 * No control is disabled while its change is on its way: the focus stays on
 * the one that was used, and a second change waits.
 */
export function FirmwareCard({ device, offline, mayManage }: { device: Device; offline: boolean; mayManage: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const now = useNow();
  const { tell } = useLog();
  const firmware = useFirmware(device);
  const update = useUpdateDevice(device.id);
  const channelId = useId();
  const channel = (update.isPending ? update.variables?.firmware?.channel : null) ?? device.firmware.channel;
  const auto = channel !== 'manual';
  const maySet = mayManage && !device.isDemo;

  const runs = firmware.running ? (
    t('devices.panel.firmwareFrom', { day: calendarDay(firmware.running.createdAt, zone) })
  ) : firmware.isPending ? (
    t('home.waiting')
  ) : firmware.isError ? (
    // A read that failed is not a build nobody knows, so it does not say the same.
    <>
      {t('devices.buildUnread')}{' '}
      <button type="button" className={ui.chip} onClick={firmware.refetch}>
        {t('home.retry')}
      </button>
    </>
  ) : (
    t('devices.panel.firmwareUnknown')
  );

  // What is on its way or waiting, one line: an update told and not back yet, one that did not take, or a newer build.
  const next = firmware.owedId
    ? device.state.updateFailedAt
      ? t('devices.panel.updateFailed', { ago: t('devices.ago', { age: ageLabel(device.state.updateFailedAt, now) }) })
      : t('devices.panel.updateOwed')
    : firmware.offered
      ? t('device.firmware.there', { day: calendarDay(firmware.offered.createdAt, zone) })
      : firmware.coming
        ? t('device.firmware.coming', { day: calendarDay(firmware.coming.createdAt, zone) })
        : null;

  // `firmware` is written whole, so the pinned build goes back as it was: a channel chosen tells the device to install nothing.
  const set = (to: FirmwareChannel) => update.mutateAsync({ firmware: { channel: to, targetId: device.firmware.targetId } });
  const change = (to: FirmwareChannel) => {
    const before = device.firmware.channel;
    if (to === before || update.isPending) return;
    void set(to).then(
      () => tell({ label: t(`device.firmware.told.${to}`), undo: () => set(before), from: `firmware-${device.id}` }),
      // Said under the controls, from the write that refused.
      () => undefined,
    );
  };

  return (
    <section className={`${ui.card} ${styles.card}`} aria-labelledby={`${channelId}-title`}>
      <h2 className={styles.cardTitle} id={`${channelId}-title`}>
        {t('devices.panel.firmware')}
      </h2>
      <div className={styles.firmwareRuns}>
        <span className={styles.firmwareText}>
          {runs}
          {next ? <span className={styles.rowLine}>{next}</span> : null}
        </span>
        <UpdateButton device={device} offline={offline} label={t('device.firmware.updateNow')} />
      </div>

      {maySet ? (
        <>
          <div className={styles.setting}>
            <span className={styles.settingName}>
              {t('autoUpdate.label')}
              <Help topic="firmwareChannel" />
            </span>
            <Switch label={t('autoUpdate.label')} on={auto} onChange={on => change(on ? 'stable' : 'manual')} />
          </div>
          {auto ? (
            <label className={styles.setting} htmlFor={channelId}>
              <span className={styles.settingName}>
                {t('updateChannel.label')}
                <Help topic="advanced.updateChannel" />
              </span>
              <select
                id={channelId}
                className={`${ui.input} ${styles.select}`}
                value={channel}
                onChange={event => change(event.target.value as FirmwareChannel)}
              >
                {RELEASE_CHANNELS.map(one => (
                  <option key={one} value={one}>
                    {t(`updateChannel.${one}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Refused error={update.error} />
          {!auto && device.classId !== null ? <VersionPick device={device} offline={offline} /> : null}
        </>
      ) : (
        <p className={ui.note}>{t(`devices.panel.channel.${device.firmware.channel}`)}</p>
      )}
    </section>
  );
}

/**
 * The build a device whose updates are off is put on by hand, picked from what
 * its list offers. Installing is an update like any other: it waits for a
 * device that is not heard.
 */
function VersionPick({ device, offline }: { device: Device; offline: boolean }) {
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

  // A class without a single build has nothing to pick from, and says so without a list to open.
  if (firmwares.data && builds.length === 0) return <p className={ui.note}>{t('firmwarePin.none')}</p>;

  return (
    <>
      <div className={styles.setting} data-wraps>
        <span className={styles.settingName}>
          {t('firmwarePin.label')}
          <Help topic="advanced.firmwarePin" />
        </span>
        <span className={styles.pick}>
          <select
            className={`${ui.input} ${styles.select}`}
            aria-label={t('firmwarePin.label')}
            value={picked}
            disabled={builds.length === 0}
            onChange={event => setPicked(event.target.value)}
          >
            <option value="">{t(firmwares.isPending ? 'home.waiting' : builds.length === 0 ? 'firmwarePin.none' : 'firmwarePin.pick')}</option>
            {builds.map(one => (
              <option key={one.id} value={one.id}>
                {label(one)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={ui.button}
            disabled={!build || build.id === device.state.firmwareId}
            aria-disabled={offline || undefined}
            onClick={() => (offline ? undefined : setAsking(true))}
          >
            {t('firmwarePin.install')}
          </button>
        </span>
      </div>
      {firmwares.isError ? <p className={ui.note}>{t('devices.buildUnread')}</p> : null}
      {asking && build ? <PinSheet device={device} build={build} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
