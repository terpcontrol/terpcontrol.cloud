import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Device, EntryPage } from '@fg2/shared-types/v1';
import { useAdminUsers, useFirmwares } from '@/api/admin';
import { api } from '@/api/client';
import { noLongerThere } from '@/api/problem';
import { useRead } from '@/api/read';
import { useSpaceOverview } from '@/api/spaces';
import { placePath, timelinePath } from '@/app/places';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import { foldRepeats } from '@/ui/entries';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { flatten } from './fleet-rows';
import { useFollowCursor } from './pages';
import styles from './Admin.module.css';

/** How many of a device's own lines the page lists, newest first: enough for "since yesterday", few enough to read. */
const LINES = 60;

/**
 * One device as support needs it, whoever owns it: what it is and who has it,
 * the way to its curves, every setting it holds, and what it said lately -
 * the old diagnostics page, reached from the fleet by id, name, owner or the
 * serial number off its type plate.
 *
 * It only reads. A setting is changed by the customer, in their app; support
 * reads the document the device was sent, exactly as stored, so that "my fridge
 * does something odd" can be answered from what the fridge was told.
 */
export function DeviceDiagnosis() {
  const { t } = useTranslation();
  const { deviceId = '' } = useParams();
  const now = useNow();
  const device = useRead({
    queryKey: ['devices', deviceId],
    queryFn: ({ signal }) => api.get<Device>(`/devices/${encodeURIComponent(deviceId)}`, undefined, signal),
  });
  const lines = useRead({
    queryKey: ['entries', 'device', deviceId],
    queryFn: ({ signal }) => api.get<EntryPage>('/entries', { deviceId, limit: LINES }, signal),
  });
  const people = useAdminUsers();
  useFollowCursor(people);

  const head = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('admin.diagnosis.title')}</h1>
      <span className={`mono ${styles.crumb}`}>
        <Link to="/admin/fleet">{t('admin.fleet.title')}</Link> › {deviceId}
      </span>
    </header>
  );

  if (device.isPending) {
    return (
      <section className={styles.page}>
        {head}
        <Waiting lines={4} />
      </section>
    );
  }
  if (!device.data) {
    return noLongerThere(device.error) ? (
      <NoLongerHere what="device" />
    ) : (
      <section className={styles.page}>
        {head}
        <LoadFailed retry={() => void device.refetch()} />
      </section>
    );
  }

  const one = device.data;
  const owner = (people.data?.pages ?? []).flatMap(page => page.items).find(person => person.id === one.ownerId) ?? null;
  const seen = one.state.lastSeenAt;

  return (
    <section className={styles.page}>
      {head}

      <div className={styles.facts}>
        <Fact label={t('admin.diagnosis.device')} value={<span className="mono">{one.id}</span>} />
        <Fact label={t('admin.diagnosis.type')} value={t(`devices.type.${one.type}`, { defaultValue: one.type })} />
        <Fact label={t('admin.diagnosis.serial')} value={<span className="mono">{one.serialNumber ?? '—'}</span>} />
        <Fact
          label={t('admin.diagnosis.owner')}
          value={owner ? `@${owner.handle} · ${owner.email}` : one.ownerId ? <span className="mono">{one.ownerId}</span> : t('admin.fleet.unclaimed')}
        />
        <Fact
          label={t('admin.diagnosis.lastSeen')}
          value={
            <span className={`mono ${styles.liveness}`} data-liveness={deviceLiveness(seen, now)}>
              <span className={styles.dot} aria-hidden />
              {seen ? ageLabel(seen, now) : t('admin.fleet.neverSeen')}
            </span>
          }
        />
        <Fact label={t('admin.diagnosis.firmware')} value={<Build device={one} />} />
        {one.spaceId ? <Place spaceId={one.spaceId} /> : <Fact label={t('admin.diagnosis.place')} value={t('admin.fleet.noPlace')} />}
      </div>

      {one.spaceId ? (
        <div className={styles.row}>
          <Link className={ui.button} to={timelinePath(one.spaceId)}>
            {t('admin.diagnosis.timeline')}
          </Link>
          <Link className={ui.button} to={`/charts?space=${encodeURIComponent(one.spaceId)}`}>
            {t('admin.diagnosis.charts')}
          </Link>
          <Link className={ui.button} to={placePath(one.spaceId)}>
            {t('admin.diagnosis.cockpit')}
          </Link>
        </div>
      ) : null}

      <div className={styles.columns}>
        <section className={styles.tableCard}>
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.settings')}</h2>
          {one.configuration ? (
            <Settings rows={flatten(one.configuration)} />
          ) : (
            <p className={`${ui.note} ${styles.cardNote}`}>{t('admin.diagnosis.noSettings')}</p>
          )}
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.factors')}</h2>
          <Settings rows={flatten({ ...one.settings, control: one.control })} />
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.hardware')}</h2>
          <Settings rows={flatten(one.state.hardware)} />
        </section>

        <section className={styles.tableCard}>
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.lines')}</h2>
          {lines.isPending ? (
            <Waiting lines={3} />
          ) : !lines.data ? (
            <LoadFailed retry={() => void lines.refetch()} />
          ) : lines.data.items.length === 0 ? (
            <p className={`${ui.note} ${styles.cardNote}`}>{t('admin.diagnosis.noLines')}</p>
          ) : (
            <ul className={styles.lines}>
              {foldRepeats(lines.data.items).map(({ entry, count, since }) => (
                <EntryRow key={entry.id} entry={entry} people={[]} now={now} byline={false} brief repeats={count > 1 ? { count, since } : null} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className="label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** The place the device stands in, by the name its owner gave it. */
function Place({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const overview = useSpaceOverview(spaceId);

  return <Fact label={t('admin.diagnosis.place')} value={overview.data?.name ?? <span className="mono">{spaceId}</span>} />;
}

/** The build it reports, by the version it was stamped with where this install has a record of it. */
function Build({ device }: { device: Device }) {
  const firmwares = useFirmwares(device.classId);
  const build = (firmwares.data?.pages ?? []).flatMap(page => page.items).find(one => one.id === device.state.firmwareId);

  return (
    <span className="mono">
      {build ? `${build.version || build.name}` : (device.state.firmwareId ?? '—')} · {device.firmware.channel}
    </span>
  );
}

function Settings({ rows }: { rows: [string, string][] }) {
  return (
    <table className={styles.settings}>
      <tbody>
        {rows.map(([path, value]) => (
          <tr key={path}>
            <td>{path}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
