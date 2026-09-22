import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceClass, DeviceClassUpdate, Firmware, FleetClass } from '@fg2/shared-types/v1';
import { useUpdateDeviceClass } from '@/api/admin';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { CHANNELS, channelStands, classSize, staged } from './rollout';
import styles from './Admin.module.css';

/**
 * The staged rollout of one device class, drawn so that what a change would do
 * can be read before it is made.
 *
 * Nothing here writes as it is typed. A channel pointed at a build, a stage
 * raised from ten per cent to fifty, a pause lifted - each of those reaches
 * hardware in somebody's tent within minutes, and a switch that had already
 * done it by the time its consequence was read would be the opposite of what
 * this screen is for. So the controls make a draft, the lines under them say
 * what applying the draft would reach, and the sheet says it once more with the
 * counts in it before the one write goes out.
 *
 * The write is a `PATCH` carrying only the fields that changed, because a class
 * is one document and sending all of it back would overwrite whatever another
 * operator changed in between.
 */

interface Draft {
  stable: string | null;
  beta: string | null;
  alpha: string | null;
  percent: number;
  paused: boolean;
  concurrentUpdates: number;
  maxFailures: number;
}

const draftOf = (deviceClass: DeviceClass): Draft => ({
  stable: deviceClass.firmwareIds.stable,
  beta: deviceClass.firmwareIds.beta,
  alpha: deviceClass.firmwareIds.alpha,
  percent: deviceClass.rollout.percent,
  paused: deviceClass.rollout.paused,
  concurrentUpdates: deviceClass.concurrentUpdates,
  maxFailures: deviceClass.maxFailures,
});

/** Only what changed. A field that is the same as the stored one is left out, so nobody's parallel change is undone by this one. */
const changesOf = (deviceClass: DeviceClass, draft: Draft): DeviceClassUpdate => {
  const update: DeviceClassUpdate = {};
  const ids = { stable: draft.stable, beta: draft.beta, alpha: draft.alpha };

  if (CHANNELS.some(channel => deviceClass.firmwareIds[channel] !== ids[channel])) update.firmwareIds = ids;
  if (deviceClass.rollout.percent !== draft.percent || deviceClass.rollout.paused !== draft.paused) {
    update.rollout = { percent: draft.percent, paused: draft.paused };
  }
  if (deviceClass.concurrentUpdates !== draft.concurrentUpdates) update.concurrentUpdates = draft.concurrentUpdates;
  if (deviceClass.maxFailures !== draft.maxFailures) update.maxFailures = draft.maxFailures;

  return update;
};

export function ClassRollout({
  deviceClass,
  fleetClass,
  devices,
  firmwares,
  now,
}: {
  deviceClass: DeviceClass;
  fleetClass: FleetClass | undefined;
  devices: Device[];
  firmwares: Firmware[];
  now: DateTime;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(deviceClass));
  const [asking, setAsking] = useState(false);
  const update = useUpdateDeviceClass();

  const ours = firmwares.filter(build => build.classId === deviceClass.id);
  const stands = channelStands(deviceClass, fleetClass, devices, firmwares, now);
  const size = classSize(deviceClass, devices, now);
  const changes = changesOf(deviceClass, draft);
  const dirty = Object.keys(changes).length > 0;

  const nameOf = (firmwareId: string | null): string =>
    firmwareId ? (ours.find(build => build.id === firmwareId)?.name ?? firmwareId) : t('admin.firmware.noBuild');

  // What applying the draft would do, one sentence per thing that changed.
  const consequences: string[] = [];
  for (const channel of CHANNELS) {
    const stand = stands.find(one => one.channel === channel)!;
    if (deviceClass.firmwareIds[channel] === draft[channel]) continue;
    consequences.push(
      draft[channel]
        ? t('admin.firmware.willPoint', {
            channel: t(`devices.channel.${channel}`),
            build: nameOf(draft[channel]),
            devices: t('admin.count.devices', { count: stand.devices }),
            reach: staged(draft.percent, stand.devices),
            concurrent: draft.concurrentUpdates,
          })
        : t('admin.firmware.willUnpoint', { channel: t(`devices.channel.${channel}`), devices: t('admin.count.devices', { count: stand.devices }) }),
    );
  }
  if (deviceClass.rollout.percent !== draft.percent) {
    consequences.push(
      t('admin.firmware.willStage', {
        from: deviceClass.rollout.percent,
        to: draft.percent,
        before: staged(deviceClass.rollout.percent, size.total),
        after: staged(draft.percent, size.total),
        ofDevices: t('admin.count.ofDevices', { count: size.total }),
      }),
    );
  }
  if (deviceClass.rollout.paused !== draft.paused) {
    consequences.push(draft.paused ? t('admin.rollout.pauseWhat') : t('admin.rollout.resumeWhat'));
  }
  if (deviceClass.concurrentUpdates !== draft.concurrentUpdates || deviceClass.maxFailures !== draft.maxFailures) {
    consequences.push(
      t('admin.firmware.willPace', {
        devices: t('admin.count.devices', { count: draft.concurrentUpdates }),
        failures: t('admin.count.failedUpdates', { count: draft.maxFailures }),
      }),
    );
  }

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className={styles.blockName}>{deviceClass.name}</span>
        <span className={`mono ${styles.consequence}`}>
          {`${t('admin.count.devices', { count: fleetClass?.total ?? size.total })} · ${t('admin.count.online', { count: fleetClass?.online ?? size.online })}`}
          {deviceClass.description ? ` · ${deviceClass.description}` : ''}
        </span>
      </div>

      {CHANNELS.map(channel => {
        const stand = stands.find(one => one.channel === channel)!;

        return (
          <label key={channel} className={styles.field}>
            <span className="label">
              {`${t(`devices.channel.${channel}`)} · ${t('admin.count.devices', { count: stand.devices })} · ${t('admin.count.online', { count: stand.online })}`}
            </span>
            <select
              className={`mono ${ui.input} ${styles.menu}`}
              value={draft[channel] ?? ''}
              onChange={event => setDraft({ ...draft, [channel]: event.target.value || null })}
            >
              <option value="">{t('admin.firmware.noBuild')}</option>
              {/* Newest first, as the server listed them. A build's version is a
                  uuid, so nothing here is ordered or ranked by it. */}
              {ours.map(build => (
                <option key={build.id} value={build.id}>
                  {build.name ? `${build.name} · ${build.version}` : build.version}
                </option>
              ))}
            </select>
          </label>
        );
      })}

      <label className={styles.field}>
        <span className="label">{t('admin.firmware.stage')}</span>
        <span className={styles.row}>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.percent}
            aria-label={t('admin.firmware.stage')}
            onChange={event => setDraft({ ...draft, percent: Number(event.target.value) })}
          />
          <span className={`mono ${styles.consequence}`}>
            {t('admin.firmware.stageReach', {
              percent: draft.percent,
              reach: staged(draft.percent, size.total),
              ofDevices: t('admin.count.ofDevices', { count: size.total }),
            })}
          </span>
        </span>
      </label>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className="label">{t('admin.firmware.concurrent')}</span>
          <input
            className={`mono ${ui.input}`}
            type="number"
            min={1}
            value={draft.concurrentUpdates}
            onChange={event => setDraft({ ...draft, concurrentUpdates: Number(event.target.value) })}
          />
        </label>
        <label className={styles.field}>
          <span className="label">{t('admin.firmware.maxFailures')}</span>
          <input
            className={`mono ${ui.input}`}
            type="number"
            min={1}
            value={draft.maxFailures}
            onChange={event => setDraft({ ...draft, maxFailures: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className={styles.row}>
        <button
          type="button"
          className={`${ui.chip} ${draft.paused ? styles.paused : ''}`}
          role="switch"
          aria-checked={draft.paused}
          onClick={() => setDraft({ ...draft, paused: !draft.paused })}
        >
          {draft.paused ? t('admin.rollout.pausedChip') : t('admin.rollout.runningChip')}
        </button>
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={!dirty || update.isPending} onClick={() => setAsking(true)}>
          {t('admin.firmware.apply')}
        </button>
        <button type="button" className={ui.button} disabled={!dirty || update.isPending} onClick={() => setDraft(draftOf(deviceClass))}>
          {t('admin.firmware.discard')}
        </button>
      </div>

      {dirty ? (
        <ul className={styles.lines}>
          {consequences.map(line => (
            <li key={line} className={styles.consequence}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <Refused error={update.error} />

      {asking ? (
        <Sheet
          title={t('admin.firmware.confirmTitle', { name: deviceClass.name })}
          onClose={() => setAsking(false)}
          actions={
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { classId: deviceClass.id, body: changes },
                  {
                    onSuccess: () => setAsking(false),
                  },
                )
              }
            >
              {t('admin.firmware.confirmYes')}
            </button>
          }
        >
          <p className={styles.sheetBody}>{t('admin.firmware.confirmBody')}</p>
          <ul className={styles.lines}>
            {consequences.map(line => (
              <li key={line} className={styles.sheetBody}>
                {line}
              </li>
            ))}
          </ul>
          <Refused error={update.error} />
        </Sheet>
      ) : null}
    </div>
  );
}
