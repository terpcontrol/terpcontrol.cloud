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
import type { i18n as I18n } from 'i18next';
import type { Translate } from '@/i18n/i18n';
import { settingWords } from '@/i18n/configuration-change';
import { ageLabel, deviceLiveness, sinceLabel } from '@/ui/age';
import { sensorFactorsOf } from '@/ui/climate-hardware';
import { EntryWords } from '@/ui/EntryWords';
import { foldRepeats, warningOf } from '@/ui/entries';
import { Line, Lines } from '@/ui/Lines';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { AdminHead, AdminNotLoaded, Liveness } from './parts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, useZone } from '@/ui/zone';
import { flatten } from './fleet-rows';
import { buildLabel, typeName } from '@/ui/naming';
import styles from './Admin.module.css';

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
  const { t, i18n } = useTranslation();
  const { deviceId = '' } = useParams();
  const now = useNow();
  const zone = useZone();
  const device = useRead(deviceQuery(deviceId));
  const lines = useDeviceEntries(deviceId);
  const people = useAdminUsers();
  useFollowCursor(people);

  const head = <AdminHead title={t('admin.diagnosis.title')} of={deviceId} readAt={device.dataUpdatedAt} />;

  if (device.isPending) return <AdminNotLoaded head={head} />;
  if (!device.data) {
    return noLongerThere(device.error) ? <NoLongerHere what="device" /> : <AdminNotLoaded head={head} read={device} />;
  }

  const one = device.data;
  const owner = itemsOf(people.data).find(person => person.id === one.ownerId) ?? null;
  const seen = one.state.lastSeenAt;

  return (
    <section className={ui.stack4}>
      {head}

      <div className={styles.facts}>
        <Fact label={t('admin.diagnosis.device')} value={one.id} />
        <Fact label={t('admin.diagnosis.type')} value={typeName(one.type, t)} />
        <Fact label={t('admin.diagnosis.serial')} value={one.serialNumber ?? '—'} />
        <Fact
          label={t('admin.diagnosis.owner')}
          value={owner ? `@${owner.handle} · ${owner.email}` : (one.ownerId ?? unclaimedWords(t, one, zone))}
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
        <div className={ui.wrapRow}>
          <Link className={ui.button} to={timelinePath(one.spaceId)}>
            {t('admin.diagnosis.timeline')}
          </Link>
          <Link className={ui.button} to={placePath(one.spaceId)}>
            {t('admin.diagnosis.open')}
          </Link>
        </div>
      ) : null}

      <div className={styles.columns}>
        <section className={styles.tableCard}>
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.settings')}</h2>
          {one.configuration ? (
            <Settings rows={inWords(i18n, one, flatten(one.configuration), owner?.preferences.timezone ?? null)} />
          ) : (
            <p className={`${ui.note} ${styles.cardNote}`}>{t('admin.diagnosis.noSettings')}</p>
          )}
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.factors')}</h2>
          <Settings
            rows={inWords(
              i18n,
              one,
              flatten({
                ...factorsOf(one),
                control: one.control,
                // Beside a darkened lamp's `limit = 0`, the brightness it gets back.
                ...(typeof one.state.limitBeforeDark === 'number' ? { limitBeforeDark: one.state.limitBeforeDark } : {}),
              }),
              owner?.preferences.timezone ?? null,
            )}
          />
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.hardware')}</h2>
          <Settings rows={asStored(flatten(one.state.hardware))} />
        </section>

        <section className={styles.tableCard}>
          <h2 className={styles.sectionTitle}>{t('admin.diagnosis.lines')}</h2>
          {lines.isPending ? (
            <Waiting lines={3} />
          ) : !lines.data ? (
            <LoadFailed read={lines} />
          ) : lines.data.items.length === 0 ? (
            <p className={`${ui.note} ${styles.cardNote}`}>{t('admin.diagnosis.noLines')}</p>
          ) : (
            <div className={styles.cardNote}>
              <Lines>
                {/* Each line as the diary says it, stamped with its hour: support reads when, not only on which day. */}
                {foldRepeats(lines.data.items, true).map(({ entry, count, since }) => (
                  <Line key={entry.id} stamp={sinceLabel(entry.occurredAt, now, zone)} severity={warningOf(entry)}>
                    <EntryWords entry={entry} people={[]} now={now} zone={zone} byline={false} brief repeats={count > 1 ? { count, since } : null} />
                  </Line>
                ))}
              </Lines>
            </div>
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

  return <Fact label={t('admin.diagnosis.place')} value={overview.data?.name ?? spaceId} />;
}

/** The build it reports, by the version it was stamped with where this install has a record of it. */
function Build({ device }: { device: Device }) {
  const { t } = useTranslation();
  const firmwares = useFirmwares(device.classId);
  const build = itemsOf(firmwares.data).find(one => one.id === device.state.firmwareId);

  return (
    <span>
      {buildLabel(build) ?? device.state.firmwareId ?? '—'} · {t(`devices.channel.${device.firmware.channel}`)}
    </span>
  );
}

/**
 * Who has a device nobody owns: nobody ever added it, or since when nobody has - its owner gave it up, or deleted
 * their account with it - so support does not take hardware that had a home for hardware that never had one.
 */
const unclaimedWords = (t: Translate, device: Device, zone: string | null): string => {
  const released = device.state.released;
  return released ? t(`admin.diagnosis.released.${released.by}`, { date: calendarDay(released.at, zone) }) : t('admin.fleet.unclaimed');
};

/** A row of a settings table: what it is called, what it is set to, and - where those are the app's words - where the firmware keeps it. */
interface SettingRow {
  name: string;
  value: string;
  stored?: string;
}

const asStored = (rows: [string, string][]): SettingRow[] => rows.map(([name, value]) => ({ name, value }));

/** The figures the cloud keeps beside the document that this device has a use for: a fan's leaf offsets are none. */
const factorsOf = (device: Device): Partial<Device['settings']> =>
  Object.fromEntries(sensorFactorsOf(device).map(name => [name, device.settings[name]]));

/**
 * The document - and what the cloud keeps beside it - in the words the app's own screens and diary use for each
 * figure it sets (`settingWords`), each with where it is stored; a figure the app does not set as it is stored. A
 * time of day is said on both clocks: UTC, which is what the device runs on, and the customer's own, which is what
 * the customer reads in the app - "21600" alone had support doing arithmetic on the phone with somebody whose lamp
 * comes on at eight.
 */
const inWords = (i18n: I18n, device: Device, stored: [string, string][], zone: string | null): SettingRow[] => {
  const context = { type: device.type, mode: typeof device.configuration?.workmode === 'string' ? device.configuration.workmode : null };
  return stored.map(([path, raw]) => {
    const said = settingWords(i18n, path, raw, { ...context, zone: 'UTC' });
    if (!said) return { name: path, value: raw };
    const there = said.clock && zone ? settingWords(i18n, path, raw, { ...context, zone })?.value : null;
    const value = !said.clock
      ? said.value
      : there
        ? i18n.t('admin.diagnosis.clockTimeThere', { utc: said.value, there })
        : i18n.t('admin.diagnosis.clockTime', { utc: said.value });
    return { name: said.name, value, stored: `${path} = ${raw}` };
  });
};

function Settings({ rows }: { rows: SettingRow[] }) {
  return (
    <table className={styles.settings}>
      <tbody>
        {rows.map(({ name, value, stored }) => (
          <tr key={stored ?? name}>
            <td>
              {name}
              {stored ? <span className={styles.stored}>{stored}</span> : null}
            </td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
