import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceFirmware, FirmwareChannel } from '@fg2/shared-types/v1';
import { RELEASE_CHANNELS } from '@fg2/shared-types/v1-schemas/firmware-channels.js';
import { useUpdateDevice } from '@/api/devices';
import { useLog } from '@/log/log-context';
import { ageLabel } from '@/ui/age';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Switch } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { UpdateButton } from './DeviceActions';
import { buildName, useFirmware } from './firmware-builds';
import { PinSheet } from './FirmwarePin';
import styles from './DevicePage.module.css';

/**
 * A device's firmware, on its own page: what it runs, what it owes or is
 * offered, and where its updates come from.
 *
 * The build is named by when it was made (`buildDay`). One switch says whether
 * the device updates itself: on, it follows a release channel chosen beside
 * it; off (the channel `manual`), it stays on its build until one is installed
 * here, which asks first, because the device restarts with it.
 *
 * No control is disabled while its change is on its way: the focus stays on
 * the one that was used, and a second change waits.
 */
export function FirmwareCard({ device, offline, mayManage }: { device: Device; offline: boolean; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const { tell } = useLog();
  const firmware = useFirmware(device);
  const update = useUpdateDevice(device.id);
  const channelId = useId();
  const channel = (update.isPending ? update.variables?.firmware?.channel : null) ?? device.firmware.channel;
  const auto = channel !== 'manual';
  const maySet = mayManage && !device.isDemo;

  const runs = firmware.running ? (
    t('devices.panel.firmwareFrom', { day: firmware.madeOn(firmware.running) })
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
  // A device never heard reports no build and installs none, whatever its rollout names.
  const next =
    firmware.owedId && device.state.lastSeenAt
      ? device.state.updateFailedAt
        ? t('devices.panel.updateFailed', { ago: t('devices.ago', { age: ageLabel(device.state.updateFailedAt, now) }) })
        : t('devices.panel.updateOwed')
      : firmware.offered
        ? t('device.firmware.there', { day: firmware.madeOn(firmware.offered) })
        : firmware.coming
          ? t('device.firmware.coming', { day: firmware.madeOn(firmware.coming) })
          : null;

  // `firmware` is written whole, so the pinned build goes back as it was: a channel chosen tells the device to install nothing.
  const set = (to: FirmwareChannel) => update.mutateAsync({ firmware: { channel: to, targetId: device.firmware.targetId } });
  const change = (to: FirmwareChannel) => {
    const before = device.firmware.channel;
    if (to === before || update.isPending) return;
    void set(to).then(
      () =>
        tell({
          label: t(`device.firmware.told.${to}`),
          undo: () => set(before),
          undone: t(`device.firmware.told.${before}`),
          from: `firmware-${device.id}`,
        }),
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
          {!auto && device.classId !== null ? <VersionPick device={device} offline={offline} firmware={firmware} /> : null}
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
function VersionPick({ device, offline, firmware }: { device: Device; offline: boolean; firmware: ReturnType<typeof useFirmware> }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState('');
  const [asking, setAsking] = useState(false);
  const builds = [...firmware.builds].sort((one, other) => other.createdAt.localeCompare(one.createdAt));
  const build = builds.find(one => one.id === picked) ?? null;
  const label = (one: DeviceFirmware) =>
    [
      buildName(one),
      firmware.madeOn(one),
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
  if (!firmware.isPending && !firmware.isError && builds.length === 0) return <p className={ui.note}>{t('firmwarePin.none')}</p>;

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
            <option value="">{t(firmware.isPending ? 'home.waiting' : builds.length === 0 ? 'firmwarePin.none' : 'firmwarePin.pick')}</option>
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
      {firmware.isError ? <p className={ui.note}>{t('devices.buildUnread')}</p> : null}
      {asking && build ? <PinSheet device={device} build={build} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
