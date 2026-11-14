import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { Device, SocketPage as SocketTable } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useDeviceLive, useSocketTables } from '@/api/devices';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { controlPath, devicePath, placePath, timelinePath, usePageOfPlace } from '@/app/places';
import { pendingByPath } from '@/screens/control/climate/figures';
import { ControlOff } from '@/screens/control/Mode';
import { OwnSettings } from '@/screens/control/OwnSettings';
import { PageRows } from '@/screens/control/PageRows';
import { useLeads } from '@/screens/control/lead';
import { notTaken, offNotTaken } from '@/screens/control/rows';
import advancedStyles from '@/ui/advanced/Advanced.module.css';
import type { DeviceContext } from '@/ui/advanced/item';
import { itemsFor } from '@/ui/advanced/registry';
import { sinceLabel } from '@/ui/age';
import { darkReasonOf } from '@/ui/climate-hardware';
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
import type { Translate } from '@/i18n/i18n';
import { ControlRow } from './ControlSwitch';
import { DeviceActions } from './DeviceActions';
import { useDevice, useDeviceLiveness } from './device-read';
import { DeviceSettingsSheet } from './DeviceSettingsSheet';
import { FirmwareCard } from './Firmware';
import { useFirmware } from './firmware-builds';
import { ReleaseSheet } from './Release';
import { Fact, Facts } from './RowParts';
import { PairSocketRow } from './SocketSheets';
import styles from './DevicePage.module.css';

export { SocketPage } from './SocketPage';

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
 * What the place is held at is Steuerung's and is not offered again here.
 * Only a device that is not the place's climate keeps what it is set to on
 * its own page, since Steuerung draws one climate, with the rows that open
 * its own part of the pages behind Steuerung's rows (`PageRows`).
 *
 * `/advanced` and `/details` are pages under it. What may be done is asked of
 * the device rather than of the session: the same reader owns one tent and
 * only reads the next.
 */
export function DevicePage() {
  const { t } = useTranslation();
  const { deviceId = '', page = null } = useParams();
  const found = useDevice(deviceId);
  usePageOfPlace(found.device?.spaceId ?? null);
  // A page under the device keeps its own name and its way back while the device is read, and when it cannot be.
  const under = subTitle(t, page);

  if (found.gone) return <NoLongerHere what="device" />;
  if (found.isPending) {
    return under ? (
      <Under deviceId={deviceId} title={under}>
        <Waiting lines={5} />
      </Under>
    ) : (
      <Waiting lines={5} />
    );
  }
  if (!found.device) {
    return under ? (
      <Under deviceId={deviceId} title={under}>
        <LoadFailed read={found} values />
      </Under>
    ) : (
      <LoadFailed title={t('shell.gone.title.device')} read={found} values />
    );
  }

  return <DeviceScreen key={deviceId} device={found.device} among={found.among} page={page} />;
}

function DeviceScreen({ device, among, page }: { device: Device; among: Device[] | undefined; page: string | null }) {
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
  const live = useDeviceLive(device.id);
  const [naming, setNaming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  useKeptScroll(!spaces.isPending && page === null);

  const name = deviceTitle(device, t, among);
  const place = spaces.data?.items.find(space => space.id === device.spaceId) ?? null;
  // Only its owner is asked where a device stands (`DeviceSettingsSheet`): anybody else renames it there and no more.
  const settings = t(device.ownerId === user?.id ? 'devices.settings.open' : 'devices.settings.rename');
  const context: DeviceContext = { device, mayManage, offline, mayOwn, isAdmin: user?.isAdmin === true, sockets: hosts ? table : undefined };
  // Erweitert is for whoever may change the device: its items write on the tap.
  const advanced = mayManage ? itemsFor('device', context) : [];

  // What the reader may do is asked of the places: until they are read, nothing is offered and no page is refused.
  const under = subTitle(t, page);
  if (spaces.isPending) {
    return under ? (
      <Under deviceId={device.id} name={name} title={under}>
        <Waiting lines={5} />
      </Under>
    ) : (
      <Waiting lines={5} />
    );
  }

  if (page === 'advanced' && advanced.length > 0) {
    return (
      <Under deviceId={device.id} name={name} title={t('advanced.title')}>
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
      <Under deviceId={device.id} name={name} title={t('devices.panel.technical')}>
        <Technical device={device} table={hosts ? table : undefined} />
      </Under>
    );
  }
  // A page this device has not got, or no device has, is the device's own.
  if (page !== null) return <Navigate to={devicePath(device.id)} replace />;

  // Switched off while nobody heard it, the device goes on regulating: off is what is stored, said as Steuerung says it.
  const off = offNotTaken(device, pendingByPath(live.data?.pending));
  // A device leading a place says its control off - and a switch-off it has not been handed - in the box that
  // switches it on again; the line of facts does not say it a second time.
  const offBox = leads && mayManage && device.control?.running === false;
  const dark = offBox ? null : darkReasonOf(device);
  const regulation = dark ? `${t('climateControl.label')} ${t(`climateControl.state.${dark}`)}` : null;
  const stored = regulation && off ? notTaken(t, regulation, off.savedAt, now, zone) : null;
  const groups = GROUP_ORDER.filter(group => advanced.some(item => GROUPS[item.id] === group)).map(group => t(`device.advanced.${group}`));

  return (
    <section className={`${ui.stack3} ${ui.page}`}>
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
                {place.name}
              </Link>
            ) : null,
            stored ? <strong key="stored">{stored}</strong> : regulation,
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

      {/* The device a place's climate is: Steuerung says that it is off and switches it on, and so does its own page. */}
      {offBox ? <ControlOff device={device} mayManage storedAt={off?.savedAt} /> : null}
      {leads ? null : (
        <>
          <OwnSettings device={device} />
          {device.spaceId ? (
            <PageRows spaceId={device.spaceId} devices={mayManage ? [device] : []} now={now} alone>
              <Row to={`${timelinePath(device.spaceId)}&device=${encodeURIComponent(device.id)}`} title={t('device.curves')} />
            </PageRows>
          ) : null}
        </>
      )}

      <Rows>
        {mayManage ? <Row title={settings} line={place?.name ?? null} onOpen={() => setNaming(true)} /> : null}
        {hosts && mayManage && !device.isDemo ? (
          <PairSocketRow deviceId={device.id} deviceName={name} table={table} failed={tables.isError} unheard={offline || waiting} now={now} />
        ) : null}
        {advanced.length > 0 ? <Row title={t('advanced.title')} line={groups.join(', ') || null} to={devicePath(device.id, 'advanced')} /> : null}
        <Row title={t('devices.panel.technical')} line={t('device.details.line')} to={devicePath(device.id, 'details')} />
        {mayManage ? <ControlRow device={device} /> : null}
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
/** The name of a page under a device, which its head keeps whatever the page itself can show. */
const subTitle = (t: Translate, page: string | null): string | null =>
  page === 'advanced' ? t('advanced.title') : page === 'details' ? t('devices.panel.technical') : null;

/** A page under a device: its name, whose page it is - where the device has been read - and the way back to it. */
function Under({ deviceId, name = null, title, children }: { deviceId: string; name?: string | null; title: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className={`${ui.stack3} ${ui.page}`}>
      <PageHead
        title={title}
        of={name}
        back={{ to: devicePath(deviceId), label: t('device.backTo', { name: name ?? t('shell.gone.title.device') }) }}
      />
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
  const firmware = useFirmware(device);
  const owed = firmware.owedId ? (buildLabel(firmware.owed ?? undefined) ?? t('devices.update.newBuild')) : null;
  const can = table
    ? [
        table.capabilities.socketOverride ? t('devices.can.override') : null,
        table.capabilities.socketTimer ? t('devices.can.timer') : null,
        table.capabilities.lightOverride ? t('devices.can.light') : null,
      ].filter(Boolean)
    : null;

  return (
    <div className={ui.card}>
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
        <Fact label={t('devices.fact.build')} value={buildLabel(firmware.running ?? undefined) ?? '—'} />
        {owed ? <Fact label={t('devices.fact.owed')} value={owed} /> : null}
        {can ? <Fact label={t('devices.fact.can')} value={can.length > 0 ? <FactLine facts={can} /> : t('devices.can.nothing')} /> : null}
      </Facts>
    </div>
  );
}
