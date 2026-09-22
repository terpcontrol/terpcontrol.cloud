import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Camera, Device, Fleet } from '@fg2/shared-types/v1';
import { ageLabel, deviceLiveness } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { cameraFreshness } from '../devices/cameras';
import styles from './Admin.module.css';

/**
 * How the install itself is doing, in the figures it actually answers.
 *
 * The board drew more than this: MQTT connections, the size of the time-series
 * database and of the picture bucket, how many films are queued for rendering,
 * when the retention jobs last ran and with how many errors. Every one of those
 * belongs to `GET /admin/stats` and `GET /admin/logs`, which the decision
 * record lists and this server has not built - so they are named as missing
 * rather than drawn from something else that happens to be a number. A health
 * card that showed a figure nobody computed would be worse than one that is
 * short.
 *
 * What is here is counted from answers that do exist: the rollout statistics in
 * the fleet answer, the device list, and the camera list. The demo device is
 * the one the board points its "open device" button at, and it has a screen of
 * its own.
 */
export function HealthCard({ fleet, devices, cameras, now }: { fleet: Fleet; devices: Device[]; cameras: Camera[]; now: DateTime }) {
  const { t } = useTranslation();

  const updating = fleet.classes.reduce((count, one) => count + one.firmwares.reduce((sum, build) => sum + build.updating, 0), 0);
  const failed = fleet.classes.reduce((count, one) => count + one.firmwares.reduce((sum, build) => sum + build.failed, 0), 0);
  const paused = fleet.classes.filter(one => one.rollout.paused).length;

  const live = cameras.filter(camera => camera.removedAt === null);
  const quiet = live.filter(camera => cameraFreshness(camera, now) === 'offline').length;

  const demo = devices.filter(device => device.isDemo);
  const demoAlive = demo.filter(device => deviceLiveness(device.state.lastSeenAt, now) !== 'offline');
  const newest = demo.map(device => device.state.lastSeenAt).filter((at): at is string => at !== null)[0] ?? null;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className="label">{t('admin.health.title')}</span>
        <span className={styles.actions}>
          <Link className={ui.chip} to="/admin/demo">
            {t('admin.health.openDemo')}
          </Link>
        </span>
      </div>

      <span className={`mono ${styles.figure}`}>
        {t('admin.health.updates', { installing: t('admin.count.installing', { count: updating }), failed })}
      </span>

      <ul className={styles.lines}>
        <li className="mono">
          {t('admin.health.cameras', {
            cameras: t('admin.count.cameras', { count: live.length }),
            quiet: t('admin.count.quietCameras', { count: quiet }),
          })}
        </li>
        <li className="mono">{t('admin.health.unclassified', { devices: t('admin.count.devices', { count: fleet.unclassifiedDevices }) })}</li>
        <li className="mono">{t('admin.health.paused', { paused, ofClasses: t('admin.count.ofClasses', { count: fleet.classes.length }) })}</li>
        <li className="mono">
          {demo.length === 0
            ? t('admin.health.noDemo')
            : t('admin.health.demo', {
                ofDevices: t('admin.count.ofDevices', { count: demo.length }),
                online: demoAlive.length,
                age: newest ? ageLabel(newest, now) : '—',
              })}
        </li>
      </ul>

      {/* Said plainly, because an operator who cannot see a figure should know
          whether it is zero or whether nobody is counting it. */}
      <p className={`${ui.note} ${styles.consequence}`}>{t('admin.health.notAnswered')}</p>
    </section>
  );
}
