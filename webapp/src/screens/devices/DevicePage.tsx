import type { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { Device, SocketPage as SocketTable } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useDeviceFirmwares, useSocketTables } from '@/api/devices';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import {
  controlPath,
  DEVICE_PAGES,
  devicePath,
  leadingBackTo,
  placePath,
  socketPath,
  timelinePath,
  usePageOfPlace,
  type DevicePageName,
} from '@/app/places';
import { OwnSettings } from '@/screens/control/OwnSettings';
import { useLeads } from '@/screens/control/lead';
import advancedStyles from '@/ui/advanced/Advanced.module.css';
import type { DeviceContext } from '@/ui/advanced/item';
import { itemsFor } from '@/ui/advanced/registry';
import { ageLabel, sinceLabel } from '@/ui/age';
import { darkReasonOf } from '@/ui/climate-hardware';
import { CopyButton } from '@/ui/CopyButton';
import { Facts as FactLine } from '@/ui/Facts';
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
import { SocketFormSheet } from './SocketSheets';
import { socketCycle, socketName, socketState } from './socket-words';
import { rowsOf } from './sockets';
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
 * place, its smart sockets, what few growers set, what support asks for,
 * switching its regulation off and giving it away.
 *
 * What the place is held at - the light, the targets, the work mode, the
 * outputs - is Steuerung's and is not offered again here. Only a device that
 * is not the place's climate keeps what it is set to on its own page, since
 * Steuerung draws one climate.
 *
 * `/devices/:id/sockets`, `/advanced` and `/details` are pages under it and
 * lead back to it. What may be done is asked of the device rather than of the
 * session: the same reader owns one tent and only reads the next.
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

  const name = deviceTitle(device, t, among);
  const place = spaces.data?.items.find(space => space.id === device.spaceId) ?? null;
  const context: DeviceContext = { device, mayManage, offline, mayOwn, isAdmin: user?.isAdmin === true, sockets: hosts ? table : undefined };
  // Erweitert is for whoever may change the device: its items write on the tap.
  const advanced = mayManage ? itemsFor('device', context) : [];

  // What the reader may do is asked of the places: until they are read, nothing is offered and no page is refused.
  if (spaces.isPending) return <Waiting lines={5} />;

  if (page === 'sockets' && hosts) {
    return (
      <Under device={device} name={name} title={t('devices.sockets')}>
        <Sockets device={device} name={name} table={table} failed={tables.isError} offline={offline || waiting} mayManage={mayManage} now={now} />
      </Under>
    );
  }
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
  // A page this device has not got - the sockets of a lamp - is the device's own.
  if (page !== null) return <Navigate to={devicePath(device.id)} replace />;

  // Connected or not, and since when, in the words the rest of the app uses for it: a stale device is still connected, only late.
  const connection =
    liveness === 'live'
      ? t('devices.panel.connected')
      : liveness === 'stale' && heard
        ? t('devices.panel.connectedLate', { age: ageLabel(heard, now) })
        : heard
          ? t('devices.panel.offlineSince', { time: sinceLabel(heard, now, zone) })
          : t('devices.panel.neverHeard');
  const dark = darkReasonOf(device);
  const groups = GROUP_ORDER.filter(group => advanced.some(item => GROUPS[item.id] === group)).map(group => t(`device.advanced.${group}`));
  const paired = table?.items.length ?? null;

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
      <p className={styles.facts}>
        <FactLine
          facts={[
            place ? (
              <Link key="place" to={placePath(place.id)}>
                {t('device.in', { place: place.name })}
              </Link>
            ) : null,
            // Gone quiet, the box under this line dates it.
            offline ? null : connection,
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

      <FirmwareCard device={device} offline={offline || waiting} mayManage={mayManage} isAdmin={user?.isAdmin === true} />

      {/* A device that has sent nothing yet could hear neither a window nor a restart. */}
      {waiting ? null : <DeviceActions device={device} offline={offline} />}

      {leads ? null : (
        <>
          <OwnSettings device={device} />
          {device.spaceId ? (
            <Link className={`${ui.headLink} ${styles.curves}`} to={`${timelinePath(device.spaceId)}&device=${encodeURIComponent(device.id)}`}>
              {t('device.curves')} ›
            </Link>
          ) : null}
        </>
      )}

      <Rows>
        {mayManage ? (
          <Row title={t('devices.settings.open')} line={place ? t('device.standsIn', { place: place.name }) : null} onOpen={() => setNaming(true)} />
        ) : null}
        {hosts && (mayManage || (paired ?? 0) > 0) ? (
          <Row
            title={t('devices.sockets')}
            line={
              paired === null
                ? null
                : [
                    paired === 0 ? t('device.sockets.none') : t('device.sockets.paired', { count: paired }),
                    mayManage && !device.isDemo ? t(paired === 0 ? 'device.sockets.pair' : 'device.sockets.pairMore') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
            }
            to={devicePath(device.id, 'sockets')}
          />
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
 * The device's smart sockets, each a row that leads to its own page, and
 * pairing another by its address. What is true of the device rather than of a
 * socket - nobody is listening, the build holds nothing by hand - is said once
 * over the list.
 */
function Sockets({
  device,
  name,
  table,
  failed,
  offline,
  mayManage,
  now,
}: {
  device: Device;
  name: string;
  table: SocketTable | undefined;
  failed: boolean;
  offline: boolean;
  mayManage: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [pairing, setPairing] = useState(false);

  if (!table) return <p className={ui.note}>{t(failed ? 'devices.socketsFailed' : 'devices.readingSockets')}</p>;

  const rows = rowsOf(table.items);
  const notes = [offline ? t('devices.socket.offline') : null, table.capabilities.socketOverride ? null : t('devices.socket.needsFirmware')].filter(
    (note): note is string => note !== null,
  );

  return (
    <>
      {mayManage && rows.length > 0
        ? notes.map(note => (
            <p key={note} className={ui.note}>
              {note}
            </p>
          ))
        : null}
      {rows.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('device.sockets.empty')}</p>
      ) : (
        <Rows>
          {rows.map(row => (
            <Row
              key={row.key}
              to={socketPath(device.id, row.key)}
              state={leadingBackTo(pathname)}
              title={socketName(t, row)}
              line={<FactLine facts={[socketState(t, row, now), socketCycle(t, row) ?? row.address]} />}
            />
          ))}
        </Rows>
      )}
      {mayManage && !device.isDemo ? (
        <button type="button" className={ui.addRow} onClick={() => setPairing(true)}>
          + {t(rows.length === 0 ? 'socketForm.pair.label' : 'socketForm.pair.another')}
        </button>
      ) : null}
      {pairing ? (
        <SocketFormSheet deviceId={device.id} deviceName={name} capabilities={table.capabilities} socket={null} onClose={() => setPairing(false)} />
      ) : null}
    </>
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
