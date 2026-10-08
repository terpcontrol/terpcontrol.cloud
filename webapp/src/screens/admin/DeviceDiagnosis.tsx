import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { useAdminUsers, useFirmwares } from '@/api/admin';
import { deviceQuery } from '@/api/devices';
import { useDeviceEntries } from '@/api/entries';
import { itemsOf, useFollowCursor } from '@/api/pages';
import { noLongerThere } from '@/api/problem';
import { useRead } from '@/api/read';
import { useSpaceOverview } from '@/api/spaces';
import { placePath, timelinePath } from '@/app/places';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import { foldRepeats } from '@/ui/entries';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { AdminHead, AdminWaiting, Liveness } from './parts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { serverNow } from '@/api/clock';
import { offsetOf, wallClock } from '@/ui/wall-clock';
import { flatten } from './fleet-rows';
import { buildLabel, typeName } from '@/ui/naming';
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
  const device = useRead(deviceQuery(deviceId));
  const lines = useDeviceEntries(deviceId, LINES);
  const people = useAdminUsers();
  useFollowCursor(people);

  const head = <AdminHead title={t('admin.diagnosis.title')} crumb={deviceId} />;

  if (device.isPending) return <AdminWaiting head={head} />;
  if (!device.data) {
    return noLongerThere(device.error) ? <NoLongerHere what="device" /> : <AdminWaiting head={head} retry={() => void device.refetch()} />;
  }

  const one = device.data;
  const owner = itemsOf(people.data).find(person => person.id === one.ownerId) ?? null;
  const seen = one.state.lastSeenAt;

  return (
    <section className={styles.page}>
      {head}

      <div className={styles.facts}>
        <Fact label={t('admin.diagnosis.device')} value={<span className="mono">{one.id}</span>} />
        <Fact label={t('admin.diagnosis.type')} value={typeName(one.type, t)} />
        <Fact label={t('admin.diagnosis.serial')} value={<span className="mono">{one.serialNumber ?? '—'}</span>} />
        <Fact
          label={t('admin.diagnosis.owner')}
          value={owner ? `@${owner.handle} · ${owner.email}` : one.ownerId ? <span className="mono">{one.ownerId}</span> : t('admin.fleet.unclaimed')}
        />
        {/* The customer reads every time in their own zone; on the phone with them, support has to know which. */}
        {owner ? <Fact label={t('admin.diagnosis.zone')} value={owner.preferences.timezone ?? t('admin.diagnosis.noZone')} /> : null}
        <Fact
          label={t('admin.diagnosis.lastSeen')}
          value={<Liveness state={deviceLiveness(seen, now)}>{seen ? ageLabel(seen, now) : t('admin.fleet.neverSeen')}</Liveness>}
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
            <Settings rows={withClockTimes(t, flatten(one.configuration), owner?.preferences.timezone ?? null)} />
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
  const { t } = useTranslation();
  const firmwares = useFirmwares(device.classId);
  const build = itemsOf(firmwares.data).find(one => one.id === device.state.firmwareId);

  return (
    <span className="mono">
      {buildLabel(build) ?? device.state.firmwareId ?? '—'} · {t(`devices.channel.${device.firmware.channel}`)}
    </span>
  );
}

/** Where a document keeps a time of day, as seconds past midnight UTC: a controller's and a fridge's, a lamp's own, a fan's CO2 window. */
const CLOCK_PATHS = ['daynight.day', 'daynight.night', 'day', 'night', 'co2inject.day', 'co2inject.night'];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The seconds a time of day is kept as, with the clock times they are beside
 * them: UTC, which is what the device runs on, and the customer's own, which is
 * what the customer reads in the app - "21600" alone had support doing
 * arithmetic on the phone with somebody whose lamp comes on at eight.
 */
const withClockTimes = (t: Translate, rows: [string, string][], zone: string | null): [string, string][] =>
  rows.map(([path, value]) => {
    const seconds = Number(value);
    if (!CLOCK_PATHS.includes(path) || value === '' || !Number.isFinite(seconds)) return [path, value];
    const utc = wallClock(seconds, 0);
    const there = zone ? wallClock(seconds, offsetOf(serverNow(), zone)) : null;

    return [path, `${value} · ${there ? t('admin.diagnosis.clockTimeThere', { utc, there }) : t('admin.diagnosis.clockTime', { utc })}`];
  });

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
