import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Device, SocketPage as SocketTable } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useDeviceFirmwares, useLiveReads, useSocketTables } from '@/api/devices';
import { useDevicePlans } from '@/api/plans';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { controlPath, DEVICE_PAGES, devicePath, placePath, timelinePath, usePageOfPlace, type ControlPage, type DevicePageName } from '@/app/places';
import { watchable } from '@/screens/control/alarms/rules';
import { OwnSettings } from '@/screens/control/OwnSettings';
import { useLeads } from '@/screens/control/lead';
import { alarmsLine, hasMode, hasOutputs, modeLine, outputsLine, outputsOf, planLine, type RowLine } from '@/screens/control/rows';
import advancedStyles from '@/ui/advanced/Advanced.module.css';
import type { DeviceContext } from '@/ui/advanced/item';
import { itemsFor } from '@/ui/advanced/registry';
import { sinceLabel } from '@/ui/age';
import { climateLanding, darkReasonOf } from '@/ui/climate-hardware';
import { CopyButton } from '@/ui/CopyButton';
import { Facts as FactLine } from '@/ui/Facts';
import { useKeptScroll } from '@/ui/kept';
import { LivenessPill } from '@/ui/LivenessPill';
import { buildLabel, deviceTitle, typeName } from '@/ui/naming';
import { OfflineBox } from '@/ui/OfflineHelp';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, NoLongerHere, Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { ControlRow } from './ControlSwitch';
import { DeviceActions } from './DeviceActions';
import { useDevice, useDeviceLiveness } from './device-read';
import { DeviceSettingsSheet } from './DeviceSettingsSheet';
import { FirmwareCard } from './Firmware';
import { ReleaseSheet } from './Release';
import { Fact, Facts } from './RowParts';
import { PairSocketRow } from './SocketSheets';
import styles from './DevicePage.module.css';

export { SocketPage } from './SocketPage';

const isPage = (value: string | null): value is DevicePageName => (DEVICE_PAGES as readonly string[]).includes(value ?? '');

/**
 * What an Erweitert item is filed under in the line of its row, by its id. An
 * item the table does not know is behind the row all the same.
 */
const GROUPS: Readonly<Record<string, string>> = {
  'maintenance-light': 'tuning',
  'co2-night': 'tuning',
  'compressor-rest': 'tuning',
  'light-overheat': 'tuning',
  'plug-protections': 'tuning',
  'light-ramps': 'ramps',
  'light-ramp': 'ramps',
  'leaf-offsets': 'factors',
  'lux-factor': 'factors',
  'plug-co2': 'dosing',
  'co2-report': 'cylinder',
};
const GROUP_ORDER = ['tuning', 'ramps', 'factors', 'dosing', 'cylinder'];

/**
 * A device's own page, reached from its card under Steuerung: its firmware,
 * what is done to the hardware itself, and behind one row each its name and
 * place, pairing a smart socket, what few growers set, what support asks for,
 * switching its regulation off and giving it away.
 *
 * What the place is held at - the light, the targets, the work mode, the
 * outputs - is Steuerung's and is not offered again here. Only a device that
 * is not the place's climate keeps what it is set to on its own page, since
 * Steuerung draws one climate, and rows that lead to its own part of the
 * pages behind Steuerung's rows (`Steering`).
 *
 * `/advanced` and `/details` are pages under it and lead back to it; its
 * sockets are listed where they are switched, under Steuerung. What may be
 * done is asked of the device rather than of the session: the same reader
 * owns one tent and only reads the next. Come back to, the page stands where
 * it was left.
 */
export function DevicePage() {
  const { deviceId = '', page = null } = useParams();
  const found = useDevice(deviceId);
  usePageOfPlace(found.device?.spaceId ?? null);

  if (found.gone) return <NoLongerHere what="device" />;
  if (found.isPending) return <Waiting lines={5} />;
  if (!found.device) return <LoadFailed retry={found.refetch} />;
  if (page !== null && !isPage(page)) return <Navigate to={devicePath(deviceId)} replace />;

  return <DeviceScreen key={deviceId} device={found.device} among={found.among} page={page} />;
}

function DeviceScreen({ device, among, page }: { device: Device; among: Device[] | undefined; page: DevicePageName | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const navigate = useNavigate();
  const { user } = useSession();
  const may = useMayWith()(device);
  const mayManage = enough(may, 'manage');
  const mayOwn = enough(may, 'own');
  const leads = useLeads(device);
  const { heard, liveness, waiting, offline } = useDeviceLiveness(device, now);
  const hosts = SOCKET_HOST_TYPES.includes(device.type);
  const tables = useSocketTables(hosts ? [device.id] : []);
  const table = tables.tables.get(device.id);
  const spaces = useSpaces();
  const [naming, setNaming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  useKeptScroll(!spaces.isPending && page === null);

  const name = deviceTitle(device, t, among);
  const place = spaces.data?.items.find(space => space.id === device.spaceId) ?? null;
  const context: DeviceContext = { device, mayManage, offline, mayOwn, isAdmin: user?.isAdmin === true, sockets: hosts ? table : undefined };
  // Erweitert is for whoever may change the device: its items write on the tap.
  const advanced = mayManage ? itemsFor('device', context) : [];

  // What the reader may do is asked of the places: until they are read, nothing is offered and no page is refused.
  if (spaces.isPending) return <Waiting lines={5} />;

  if (page === 'advanced' && advanced.length > 0) {
    return (
      <Under device={device} name={name} title={t('advanced.title')}>
        <div className={`${ui.card} ${styles.items}`} data-advanced="device">
          <div className={advancedStyles.items}>
            {advanced.map(({ id, Item }) => (
              <Item key={id} {...context} />
            ))}
          </div>
        </div>
      </Under>
    );
  }
  if (page === 'details') {
    return (
      <Under device={device} name={name} title={t('devices.panel.technical')}>
        <Technical device={device} table={hosts ? table : undefined} />
      </Under>
    );
  }
  // A page this device has not got is the device's own.
  if (page !== null) return <Navigate to={devicePath(device.id)} replace />;

  const dark = darkReasonOf(device);
  const groups = GROUP_ORDER.filter(group => advanced.some(item => GROUPS[item.id] === group)).map(group => t(`device.advanced.${group}`));

  return (
    <section className={styles.page}>
      {/* Steuerung is where the device's card stands; a reader without it came from the place. */}
      <PageHead
        title={name}
        back={
          mayManage || !place
            ? { to: device.spaceId ? controlPath(device.spaceId) : '/control', label: t('device.backToControl') }
            : { to: placePath(place.id), label: t('device.backTo', { name: place.name }) }
        }
      >
        <LivenessPill liveness={liveness} measuredAt={heard} now={now} explain waiting={waiting} />
      </PageHead>
      {/* Where it stands, and what its regulation is away from. How it is heard is the pill's to say, once. */}
      <p className={styles.facts}>
        <FactLine
          facts={[
            place ? (
              <Link key="place" to={placePath(place.id)}>
                {t('device.in', { place: place.name })}
              </Link>
            ) : null,
            dark ? `${t('climateControl.label')} ${t(`climateControl.state.${dark}`)}` : null,
          ]}
        />
      </p>

      {/* Gone quiet: since when and what to try, and that what is set here still reaches it. */}
      {offline && heard ? (
        <OfflineBox title={t('offline.title', { device: name, time: sinceLabel(heard, now, zone) })}>
          {mayManage ? t('device.offlineKeeps') : null}
        </OfflineBox>
      ) : null}

      <FirmwareCard device={device} offline={offline || waiting} mayManage={mayManage} />

      {/* A device that has sent nothing yet could hear neither a window nor a restart. */}
      {waiting ? null : <DeviceActions device={device} offline={offline} />}

      {leads ? null : (
        <>
          <OwnSettings device={device} />
          {device.spaceId ? <Steering device={device} spaceId={device.spaceId} table={hosts ? table : undefined} mayManage={mayManage} /> : null}
        </>
      )}

      <Rows>
        {mayManage ? (
          <Row title={t('devices.settings.open')} line={place ? t('device.standsIn', { place: place.name }) : null} onOpen={() => setNaming(true)} />
        ) : null}
        {hosts && mayManage && !device.isDemo ? (
          <PairSocketRow deviceId={device.id} deviceName={name} table={table} failed={tables.isError} unheard={offline || waiting} now={now} />
        ) : null}
        {advanced.length > 0 ? <Row title={t('advanced.title')} line={groups.join(', ') || null} to={devicePath(device.id, 'advanced')} /> : null}
        <Row title={t('devices.panel.technical')} line={t('device.details.line')} to={devicePath(device.id, 'details')} />
        {mayManage ? <ControlRow device={device} offline={offline || waiting} /> : null}
        {mayOwn && !device.isDemo ? <Row title={t('release.label')} line={null} onOpen={() => setReleasing(true)} /> : null}
      </Rows>

      {naming ? <DeviceSettingsSheet device={device} onClose={() => setNaming(false)} /> : null}
      {releasing ? (
        <ReleaseSheet
          deviceId={device.id}
          onClose={() => setReleasing(false)}
          onReleased={() => void navigate(device.spaceId ? controlPath(device.spaceId) : '/control', { replace: true })}
        />
      ) : null}
    </section>
  );
}

/**
 * What Steuerung holds for a device that is not the place's climate, as rows
 * that open it there: its curves, and of the pages behind Steuerung's rows -
 * alarms, grow plan, outputs, work mode - each one this device has something
 * on, with the device unfolded (`?device=`). Nothing of them is drawn here a
 * second time. The pages are for whoever may steer; the curves for everybody.
 */
function Steering({ device, spaceId, table, mayManage }: { device: Device; spaceId: string; table: SocketTable | undefined; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const ids = mayManage ? [device.id] : [];
  const rules = useAlarmRulesOf(ids);
  const plans = useDevicePlans(ids);
  const level = useLiveReads([device.id]).levels.get(device.id) ?? null;
  // An AIR fan's speed is its own control, which this page holds: Ausgänge would only say it again and lead back here.
  const outputs = { ...outputsOf(device, table, level), speed: false };
  const page = (name: ControlPage, has: boolean, line: RowLine | null) =>
    mayManage && has ? (
      <Row
        key={name}
        to={controlPath(spaceId, name, { device: device.id })}
        title={t(`control.page.${name}`)}
        line={line ? <FactLine facts={line.text.split(' · ')} /> : null}
        warn={line?.warn}
      />
    ) : null;

  return (
    <nav aria-label={t('device.steering')}>
      <Rows>
        <Row to={`${timelinePath(spaceId)}&device=${encodeURIComponent(device.id)}`} title={t('device.curves')} />
        {page('alarms', watchable(device) || rules.rules.size > 0, rules.isPending ? null : alarmsLine(t, [...rules.rules.values()]))}
        {page('plan', climateLanding(device) !== 'nowhere' || plans.plans.length > 0, plans.isPending ? null : planLine(t, plans.plans, now))}
        {page('outputs', hasOutputs(outputs), outputsLine(t, [outputs], now, zone))}
        {page('mode', hasMode(device), modeLine(t, device))}
      </Rows>
    </nav>
  );
}

/** A page under a device's own: whose it is, what it is, and the way back to the device. */
function Under({ device, name, title, children }: { device: Device; name: string; title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={styles.page}>
      <PageHead title={title} of={name} back={{ to: devicePath(device.id), label: t('device.backTo', { name }) }} />
      {children}
    </section>
  );
}

/**
 * What only support asks for: the id printed on the hardware, the build as its
 * container stamped it, the one it is to install, and what that build takes.
 */
function Technical({ device, table }: { device: Device; table: SocketTable | undefined }) {
  const { t } = useTranslation();
  const firmwares = useDeviceFirmwares(device.id, true);
  const build = firmwares.data?.items.find(one => one.id === device.state.firmwareId);
  const owedId = device.firmware.targetId && device.firmware.targetId !== device.state.firmwareId ? device.firmware.targetId : null;
  const owed = owedId ? (buildLabel(firmwares.data?.items.find(one => one.id === owedId)) ?? t('devices.update.newBuild')) : null;
  const can = table
    ? [
        table.capabilities.socketOverride ? t('devices.can.override') : null,
        table.capabilities.socketTimer ? t('devices.can.timer') : null,
        table.capabilities.lightOverride ? t('devices.can.light') : null,
      ].filter(Boolean)
    : null;

  return (
    <div className={`${ui.card} ${styles.details}`}>
      <Facts>
        <Fact
          label={t('devices.fact.id')}
          value={
            <span className={styles.copy}>
              {device.id}
              <CopyButton value={device.id} label={t('device.details.copyId')} />
            </span>
          }
        />
        {device.serialNumber !== null ? <Fact label={t('devices.fact.serial')} value={String(device.serialNumber)} /> : null}
        {/* Through the catalogue, like every other place that prints a type: it is a contract key and not a word. */}
        <Fact label={t('devices.fact.type')} value={typeName(device.type, t)} />
        <Fact label={t('devices.fact.build')} value={buildLabel(build) ?? '—'} />
        {owed ? <Fact label={t('devices.fact.owed')} value={owed} /> : null}
        {can ? <Fact label={t('devices.fact.can')} value={can.length > 0 ? <FactLine facts={can} /> : t('devices.can.nothing')} /> : null}
      </Facts>
    </div>
  );
}
