import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAdminCameras, useAdminDevices } from '@/api/admin';
import { useGrows } from '@/api/grows';
import { useSpaces } from '@/api/spaces';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { LoadFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { cameraFreshness } from '../devices/cameras';
import { useFollowCursor } from './pages';
import styles from './Admin.module.css';

/**
 * What the demo is showing right now.
 *
 * A demo session is not an account: it is a reader that may see every object
 * marked as a demo one and write nothing, so "what the demo shows" is exactly
 * the set of spaces, devices, cameras and grows carrying that mark. This screen
 * reads the same objects through an administrator's session, which sees
 * everything, and keeps only those - which is why the lists here are the demo
 * visitor's view and not a copy of it.
 *
 * Nothing on this screen writes. Whether an object is a demo object is a
 * property of the database with no route behind it, by decision rather than by
 * omission: it is set where the demo is seeded and is not a switch an operator
 * flips while somebody is in the middle of the tour. The screen says so rather
 * than offering a control that would be refused, and the one figure it is read
 * for - whether the device is alive - is the device's own last word.
 */
export function Demo() {
  const { t } = useTranslation();
  const now = useNow();

  const devices = useAdminDevices();
  const spaces = useSpaces();
  const cameras = useAdminCameras();
  const grows = useGrows();

  useFollowCursor(devices);
  useFollowCursor(cameras);

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('admin.demo.title')}</h1>
      <span className={`mono ${styles.crumb}`}>
        <Link to="/admin/fleet">{t('admin.fleet.title')}</Link> › {t('admin.demo.title')}
      </span>
    </header>
  );

  if (devices.isPending) {
    return (
      <section className={styles.page}>
        {header}
        <Waiting lines={3} />
      </section>
    );
  }

  if (!devices.data) {
    return (
      <section className={styles.page}>
        {header}
        <LoadFailed retry={() => void devices.refetch()} />
      </section>
    );
  }

  const shownDevices = devices.data.pages.flatMap(page => page.items).filter(device => device.isDemo);
  const shownSpaces = (spaces.data?.items ?? []).filter(space => space.isDemo);
  const shownCameras = (cameras.data?.pages ?? []).flatMap(page => page.items).filter(camera => camera.isDemo && camera.removedAt === null);
  const shownGrows = (grows.data?.items ?? []).filter(grow => grow.isDemo);

  return (
    <section className={styles.page}>
      {header}

      <p className={`${ui.note} ${styles.consequence}`}>{t('admin.demo.what')}</p>

      {shownDevices.length === 0 && shownSpaces.length === 0 && shownGrows.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('admin.demo.empty')}</p>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className="label">{t('admin.demo.devices')}</span>
          <span className={`mono ${styles.consequence}`}>{t('admin.demo.deviceCount', { devices: shownDevices.length })}</span>
        </div>
        <ul className={styles.lines}>
          {shownDevices.map(device => {
            const liveness = deviceLiveness(device.state.lastSeenAt, now);

            return (
              <li key={device.id} className={styles.row}>
                <span className="mono">{device.id}</span>
                <span>{device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type })}</span>
                <span className={`mono ${styles.liveness}`} data-liveness={liveness}>
                  <span className={styles.dot} aria-hidden />
                  {t(`home.liveness.${liveness}`)}
                  {device.state.lastSeenAt ? ` · ${ageLabel(device.state.lastSeenAt, now)}` : ''}
                </span>
                {device.spaceId ? (
                  <Link className={ui.chip} to={`/spaces/${device.spaceId}/devices`}>
                    {t('admin.demo.open')}
                  </Link>
                ) : null}
              </li>
            );
          })}
          {shownDevices.length === 0 ? <li className={ui.note}>{t('admin.demo.noDevice')}</li> : null}
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className="label">{t('admin.demo.places')}</span>
        </div>
        <ul className={styles.lines}>
          {shownSpaces.map(space => (
            <li key={space.id} className={styles.row}>
              <Link className="mono" to={`/spaces/${space.id}`}>
                {space.name}
              </Link>
              <span className={styles.consequence}>{t(`publicPage.spaceKind.${space.kind}`, { defaultValue: space.kind })}</span>
            </li>
          ))}
          {shownSpaces.length === 0 ? <li className={ui.note}>{t('admin.demo.noPlace')}</li> : null}
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className="label">{t('admin.demo.grows')}</span>
        </div>
        <ul className={styles.lines}>
          {shownGrows.map(grow => (
            <li key={grow.id} className={styles.row}>
              <Link to={`/grows/${grow.id}`}>{grow.name}</Link>
              <span className={`mono ${styles.consequence}`}>
                {grow.summary.dayNumber !== null ? t('home.card.dayN', { day: grow.summary.dayNumber }) : t('admin.demo.notStarted')}
                {grow.visibility === 'public' ? ` · ${t('admin.demo.public')}` : ''}
              </span>
            </li>
          ))}
          {shownGrows.length === 0 ? <li className={ui.note}>{t('admin.demo.noGrow')}</li> : null}
        </ul>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className="label">{t('admin.demo.cameras')}</span>
        </div>
        <ul className={styles.lines}>
          {shownCameras.map(camera => (
            <li key={camera.id} className={styles.row}>
              <Link className="mono" to={`/cameras/${camera.id}`}>
                {camera.name}
              </Link>
              <span className={`mono ${styles.liveness}`} data-liveness={cameraFreshness(camera, now)}>
                <span className={styles.dot} aria-hidden />
                {camera.state.lastStillAt ? t('devices.ago', { age: ageLabel(camera.state.lastStillAt, now) }) : t('devices.noStill')}
              </span>
            </li>
          ))}
          {shownCameras.length === 0 ? <li className={ui.note}>{t('admin.demo.noCamera')}</li> : null}
        </ul>
      </section>
    </section>
  );
}
