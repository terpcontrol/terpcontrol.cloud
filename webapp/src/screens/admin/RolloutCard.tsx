import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, DeviceClass, Firmware, Fleet } from '@fg2/shared-types/v1';
import { useUpdateDeviceClass } from '@/api/admin';
import { Refused } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { channelStands, classSize, staged } from './rollout';
import styles from './Admin.module.css';

/**
 * What every class of the fleet is being handed, and the one control that can
 * be pressed without leaving the fleet: the pause.
 *
 * Pausing is the only rollout change that is safe to make from a summary. It
 * takes devices away from nothing and can be undone by the same button, whereas
 * pointing a channel at a build is a decision about which build - which needs
 * the list of them, and lives on the Firmware screen. So this card states the
 * figures and hands the rest over rather than offering a control that would
 * have to guess what it was pointing at.
 *
 * Every line here is a count the server answered: how many devices a class has
 * and how many are talking come from the fleet answer, how many follow a
 * channel is counted off the device list, and the share a stage reaches is what
 * a percentage of that count is - said as "about", because the server takes the
 * share from each device's id rather than by counting.
 */
export function RolloutCard({
  fleet,
  classes,
  devices,
  firmwares,
  now,
}: {
  fleet: Fleet;
  classes: DeviceClass[];
  devices: Device[];
  firmwares: Firmware[];
  now: DateTime;
}) {
  const { t } = useTranslation();
  const update = useUpdateDeviceClass();

  // A class nothing has ever registered against is not what this card is for;
  // the Firmware screen lists every one of them, empty or not.
  const populated = classes.filter(one => (fleet.classes.find(row => row.classId === one.id)?.total ?? 0) > 0);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className="label">{t('admin.rollout.title')}</span>
        <span className={styles.actions}>
          <Link className={ui.chip} to="/admin/firmware">
            {t('admin.rollout.upload')}
          </Link>
          <Link className={ui.chip} to="/admin/firmware">
            {t('admin.rollout.channels')}
          </Link>
        </span>
      </div>

      <p className={`${ui.note} ${styles.consequence}`}>{t('admin.rollout.how')}</p>

      {populated.length === 0 ? <p className={ui.note}>{t('admin.rollout.nothing')}</p> : null}

      {populated.map(deviceClass => {
        const fleetClass = fleet.classes.find(row => row.classId === deviceClass.id);
        const stands = channelStands(deviceClass, fleetClass, devices, firmwares, now);
        // The install's own figure where it has one: the loaded page of
        // devices is what this browser holds, not what the stage will reach.
        const loaded = classSize(deviceClass, devices, now);
        const size = { total: fleetClass?.total ?? loaded.total, online: fleetClass?.online ?? loaded.online };
        const paused = deviceClass.rollout.paused;
        const percent = deviceClass.rollout.percent;

        return (
          <div key={deviceClass.id} className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockName}>{deviceClass.name}</span>
              <span className={`mono ${styles.consequence}`}>
                {`${t('admin.count.devices', { count: size.total })} · ${t('admin.count.online', { count: size.online })}`}
              </span>
            </div>

            <ul className={styles.lines}>
              {stands.map(stand => (
                <li key={stand.channel} className="mono">
                  {t(`devices.channel.${stand.channel}`)} ·{' '}
                  {stand.firmwareId
                    ? t('admin.rollout.stand', {
                        build: stand.label,
                        running: t('admin.count.running', { count: stand.running }),
                        devices: stand.devices,
                      })
                    : t('admin.rollout.noBuild')}
                </li>
              ))}
            </ul>

            <p className={`mono ${styles.consequence}`}>
              {paused
                ? t('admin.rollout.pausedNow', { percent })
                : t('admin.rollout.stagedNow', {
                    percent,
                    reach: staged(percent, size.total),
                    ofDevices: t('admin.count.ofDevices', { count: size.total }),
                    concurrent: deviceClass.concurrentUpdates,
                  })}
            </p>

            <div className={styles.row}>
              <button
                type="button"
                className={`${ui.chip} ${paused ? '' : styles.paused}`}
                disabled={update.isPending}
                onClick={() => update.mutate({ classId: deviceClass.id, body: { rollout: { paused: !paused, percent } } })}
              >
                {paused ? t('admin.rollout.resume') : t('admin.rollout.pause')}
              </button>
              <span className={styles.consequence}>{paused ? t('admin.rollout.resumeWhat') : t('admin.rollout.pauseWhat')}</span>
            </div>
          </div>
        );
      })}

      <Refused error={update.error} />
    </section>
  );
}
