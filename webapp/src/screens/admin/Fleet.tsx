import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { User } from '@fg2/shared-types/v1';
import { useAdminDevices, useAdminUsers, useDeviceClasses, useFirmwares, useFleet } from '@/api/admin';
import { useCameras } from '@/api/cameras';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { filteredRows, fleetRows, NO_FILTER, typesOf, type FleetFilter, type FleetRow } from './fleet-rows';
import { HealthCard } from './HealthCard';
import { useFollowCursor } from './pages';
import { RolloutCard } from './RolloutCard';
import styles from './Admin.module.css';

/**
 * The fleet, as whoever runs this install reads it: every piece of hardware
 * that has registered with this cloud, whoever owns it, and what it is running.
 *
 * It is one table rather than the cards the rest of the app is made of, because
 * the questions asked here are comparisons - which devices have gone quiet,
 * which are behind the build their class calls stable, how many of a type there
 * are - and a column of cards answers none of them. The counts in the heading
 * come from `GET /admin/fleet`, which counts the whole fleet in the database;
 * the rows come from the device list, which is paged, so the two are stated
 * apart and the table says how much of the fleet it is showing.
 *
 * What the board draws and this does not is the alarms of the last seven days
 * per device: no read answers a count of alerts over a range, and a number
 * arrived at by paging the inbox until the dates ran out would be the client's
 * arithmetic on a page rather than the server's answer. The health card names
 * that, and the rest of what this install does not answer yet, in one line.
 */
export function Fleet() {
  const { t } = useTranslation();
  const now = useNow();
  const [filter, setFilter] = useState<FleetFilter>(NO_FILTER);

  const fleet = useFleet();
  const devices = useAdminDevices();
  const people = useAdminUsers();
  const cameras = useCameras();
  const classes = useDeviceClasses();
  const firmwares = useFirmwares(null);

  useFollowCursor(devices);
  useFollowCursor(people);
  useFollowCursor(firmwares);
  useReportFreshness(fleet.dataUpdatedAt ? new Date(fleet.dataUpdatedAt).toISOString() : null);

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{t('admin.fleet.title')}</h1>
    </header>
  );

  if (fleet.isPending || devices.isPending) {
    return (
      <section className={styles.page}>
        {header}
        <Waiting lines={4} />
      </section>
    );
  }

  if (!fleet.data || !devices.data) {
    return (
      <section className={styles.page}>
        {header}
        <LoadFailed retry={() => void fleet.refetch()} />
      </section>
    );
  }

  const known: Map<string, User> = new Map((people.data?.pages ?? []).flatMap(page => page.items).map(one => [one.id, one]));
  const rows = fleetRows({
    devices: devices.data.pages.flatMap(page => page.items),
    cameras: cameras.data?.items ?? [],
    classes: classes.data?.items ?? [],
    firmwares: (firmwares.data?.pages ?? []).flatMap(page => page.items),
    people: known,
  });
  const shown = filteredRows(rows, filter, now);

  const counted = fleet.data.classes.reduce((total, one) => total + one.total, 0) + fleet.data.unclassifiedDevices;
  const online = fleet.data.classes.reduce((total, one) => total + one.online, 0);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('admin.fleet.title')}</h1>
        <span className={`mono ${styles.counts}`}>
          {`${t('admin.count.devices', { count: counted })} · ${t('admin.count.online', { count: online })}`}
        </span>
        <Filters filter={filter} onChange={setFilter} types={typesOf(rows)} />
      </header>

      <RefreshFailed failedAt={fleet.isError ? fleet.dataUpdatedAt : null} now={now} />

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('admin.fleet.column.device')}</th>
              <th>{t('admin.fleet.column.type')}</th>
              <th>{t('admin.fleet.column.owner')}</th>
              <th>{t('admin.fleet.column.firmware')}</th>
              <th>{t('admin.fleet.column.lastSeen')}</th>
              <th>{t('admin.fleet.column.sockets')}</th>
              <th>{t('admin.fleet.column.open')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <Row key={`${row.kind}:${row.id}`} row={row} now={now} />
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.row}>
        <span className={`mono ${styles.consequence}`}>{t('admin.fleet.showing', { shown: shown.length, loaded: rows.length, total: counted })}</span>
        {devices.hasNextPage ? (
          <button type="button" className={ui.chip} onClick={() => void devices.fetchNextPage()} disabled={devices.isFetchingNextPage}>
            {t('admin.fleet.loadMore')}
          </button>
        ) : null}
      </div>

      <div className={styles.cards}>
        <RolloutCard
          fleet={fleet.data}
          classes={classes.data?.items ?? []}
          devices={devices.data.pages.flatMap(page => page.items)}
          firmwares={(firmwares.data?.pages ?? []).flatMap(page => page.items)}
          now={now}
        />
        <HealthCard fleet={fleet.data} devices={devices.data.pages.flatMap(page => page.items)} cameras={cameras.data?.items ?? []} now={now} />
      </div>
    </section>
  );
}

/** The board's four: the type menu, the two switches, and the field that reads what is on a row. */
function Filters({ filter, onChange, types }: { filter: FleetFilter; onChange: (filter: FleetFilter) => void; types: string[] }) {
  const { t } = useTranslation();

  return (
    <div className={styles.chips}>
      <select
        className={`${ui.chip} ${styles.menu}`}
        aria-label={t('admin.fleet.filter.type')}
        value={filter.type ?? ''}
        onChange={event => onChange({ ...filter, type: event.target.value || null })}
      >
        <option value="">{t('admin.fleet.filter.allTypes')}</option>
        {types.map(type => (
          <option key={type} value={type}>
            {typeLabel(type, t)}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={`${ui.chip} ${filter.quiet ? styles.chipOn : ''}`}
        aria-pressed={filter.quiet}
        onClick={() => onChange({ ...filter, quiet: !filter.quiet })}
      >
        {t('admin.fleet.filter.quiet')}
      </button>

      <button
        type="button"
        className={`${ui.chip} ${filter.behind ? styles.chipOn : ''}`}
        aria-pressed={filter.behind}
        onClick={() => onChange({ ...filter, behind: !filter.behind })}
      >
        {t('admin.fleet.filter.behind')}
      </button>

      <input
        className={`mono ${ui.input} ${styles.search}`}
        type="search"
        autoComplete="off"
        aria-label={t('admin.fleet.filter.search')}
        placeholder={t('admin.fleet.filter.search')}
        value={filter.search}
        onChange={event => onChange({ ...filter, search: event.target.value })}
      />
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A type is the firmware's own word for itself, or a camera kind. Neither is a sentence, so both are translated where there is a word for them. */
const typeLabel = (type: string, t: Translate): string =>
  type.startsWith('terpcam') || type === 'rtsp'
    ? t(`devices.cameraKind.${type}`, { defaultValue: type })
    : t(`devices.type.${type}`, { defaultValue: type });

function Row({ row, now }: { row: FleetRow; now: DateTime }) {
  const { t } = useTranslation();
  const liveness = deviceLiveness(row.lastSeenAt, now);

  return (
    <tr>
      <td className={styles.idCell}>
        <span className="mono">{row.id}</span>
        {row.name ? <span className={styles.rowName}> · {row.name}</span> : null}
      </td>
      <td>{typeLabel(row.type, t)}</td>
      <td>{row.ownerHandle ? `@${row.ownerHandle}` : row.ownerId ? <span className="mono">{row.ownerId}</span> : t('admin.fleet.unclaimed')}</td>
      {/* A build is a uuid and is never compared with another, so it is drawn
          as the opaque fact it is - under the name it was registered with where
          this install has one. */}
      <td className="mono">{row.firmwareName ?? row.firmwareId ?? '—'}</td>
      <td>
        <span className={`mono ${styles.liveness}`} data-liveness={liveness}>
          <span className={styles.dot} aria-hidden />
          {row.lastSeenAt ? ageLabel(row.lastSeenAt, now) : t('admin.fleet.neverSeen')}
        </span>
      </td>
      <td className={`mono ${styles.numbers}`}>
        {row.sockets ?? '—'} · {row.cams ?? '—'}
      </td>
      <td>
        {row.opens ? (
          <Link className={styles.chevron} to={row.opens} aria-label={t('admin.fleet.open', { id: row.id })}>
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        ) : (
          <span className={`mono ${styles.noWhere}`} title={t('admin.fleet.noPlace')}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}
