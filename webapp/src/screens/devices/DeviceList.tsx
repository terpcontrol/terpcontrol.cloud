import { Camera as CameraIcon, ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ActuatorRuns, Camera, ClimateVerdict, Device, OutputMetric, SocketPage, SocketRole, ValueState } from '@fg2/shared-types/v1';
import { useCameras, useLatestStills } from '@/api/cameras';
import { fetchedAt } from '@/api/clock';
import { useDeviceFirmwares, useDevices, useLightLevels, useSocketTables } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, useMayLogIn, useMayManage, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { cameraFreshness } from './cameras';
import { Fact, Facts } from './Facts';
import { isLightRole, lightOutputOf } from './lights';
import { LightOutputRow } from './LightOutputRow';
import { cameraTitle, deviceName, deviceTitle } from './naming';
import { rowsOf, type SocketRowModel } from './sockets';
import { SocketRow } from './SocketRow';
import styles from './Devices.module.css';

/**
 * Everything this account has standing somewhere: the controllers, the cameras
 * - through a controller, standalone, or a stream this cloud pulls - and every
 * smart socket with its role and its switch.
 *
 * The tent page shows the same list narrowed to one place, which is why this is
 * a component and not a screen: the Devices tab is this with a header over it.
 */
export function DeviceList({ spaceId, verdict }: { spaceId?: string; verdict?: ClimateVerdict }) {
  const { t } = useTranslation();
  const now = useNow();
  // The whole-account list draws rows from every place at once, so what may be
  // done is asked of the row and not of the screen: the same reader owns one
  // tent and only writes lines in the next, and the sockets of the two must not
  // look alike. Claiming makes a place of its own and belongs to the session.
  const mayWith = useMayWith();
  const maySetUp = useMayManage();
  const mayManageHere = useMayManage(spaceId ?? null);
  const mayLogHere = useMayLogIn(spaceId ?? null);
  const devices = useDevices();
  const cameras = useCameras(spaceId);
  const spaces = useSpaces();

  // The device that is talking is the one somebody came here for; one that has
  // gone quiet keeps its row, its place and its age, further down.
  const mine = (devices.data?.items ?? [])
    .filter(device => spaceId === undefined || device.spaceId === spaceId)
    .sort((one, other) => RANK[deviceLiveness(one.state.lastSeenAt, now)] - RANK[deviceLiveness(other.state.lastSeenAt, now)]);
  const shown = cameras.data?.items ?? [];
  const tables = useSocketTables(mine.map(device => device.id));
  // What each controller's lamp is running at. It is a reading and not a
  // setting, and it is the only word the device gives on its own light output:
  // a brightness is never acknowledged and an override is never reported back.
  const levels = useLightLevels(mine.map(device => device.id));
  const stills = useLatestStills(shown.map(camera => camera.id));

  useReportFreshness(devices.dataUpdatedAt ? fetchedAt(devices.dataUpdatedAt) : null);

  if (devices.isPending || cameras.isPending) return <Waiting lines={3} />;
  if (!devices.data || !cameras.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const placeOf = (id: string | null): string | null => spaces.data?.items.find(space => space.id === id)?.name ?? null;
  const failedAt = devices.isError || cameras.isError ? devices.dataUpdatedAt : null;

  return (
    <div className={styles.list}>
      <RefreshFailed failedAt={failedAt} now={now} />

      {/* On a tent's own tab the switches below are simply gone for somebody
          who may only write lines, and a list of rows with nothing to press is
          the kind of absence that reads as a fault. */}
      {spaceId !== undefined && mayLogHere && !mayManageHere ? <p className={`mono ${styles.role}`}>{t('devices.youMayLog')}</p> : null}

      <Section label={t('devices.controllers')} empty={mine.length === 0 ? t(maySetUp ? 'devices.noDevices' : 'devices.noDevicesHere') : null}>
        {mine.map(device => (
          <DeviceRow
            key={device.id}
            device={device}
            place={placeOf(device.spaceId)}
            sockets={tables.tables.get(device.id)}
            cameras={shown.filter(camera => camera.deviceId === device.id).length}
            linked={spaceId === undefined}
            now={now}
          />
        ))}
      </Section>

      {/* A claim always makes a place of its own, so this is offered on the tab
          that shows everything and not on a tent's list, where it would read as
          adding a device to that tent. */}
      {spaceId === undefined && maySetUp ? (
        <Link className={`${ui.cardDashed} ${styles.addRow}`} to="/claim">
          + {t('claim.addDevice')}
        </Link>
      ) : null}

      <Section
        label={t('devices.cameras')}
        empty={shown.length === 0 ? t('devices.noCameras') : null}
        action={
          // Only on the Devices tab: a tent's own list is the same component,
          // and the screen behind this asks which place a camera is for rather
          // than taking the one it was opened from.
          maySetUp && spaceId === undefined ? (
            <Link className={`${ui.chip} ${styles.addCamera}`} to="/cameras/add">
              + {t('cameras.add.title')}
            </Link>
          ) : null
        }
      >
        {shown.map(camera => (
          <CameraRow
            key={camera.id}
            camera={camera}
            place={placeOf(camera.spaceId)}
            devices={devices.data!.items}
            stillId={stills.get(camera.id) ?? null}
            now={now}
          />
        ))}
      </Section>

      {mine.map(device => {
        const table = tables.tables.get(device.id);
        if (!table) return null;

        // What lights the tent stands apart from what else is plugged in, and
        // the controller's own output stands at the head of it: a grower asking
        // "why is it dark in there" is asking about one of these rows, and which
        // of them it is is the question this screen used to leave open.
        const rows = rowsOf(table.items);
        const light = lightOutputOf(device, table.capabilities, levels.levels.get(device.id) ?? null);
        const lamps = rows.filter(row => isLightRole(row.role));
        const rest = rows.filter(row => !isLightRole(row.role));
        if (!light && rows.length === 0) return null;

        // Why none of the sockets can be switched, said once per list: it is
        // true of the device and not of a row, and repeating it eight times is
        // noise. A device nobody is listening on hears nothing at all; one whose
        // build predates the override still takes every command it always did,
        // so that reason is kept apart from this one.
        const unheard = deviceLiveness(device.state.lastSeenAt, now) === 'offline' ? t('devices.socket.offline') : null;
        const refusal = !table.capabilities.socketOverride ? t('devices.socket.needsFirmware') : unheard;
        const place = placeOf(device.spaceId) ?? deviceTitle(device, t);
        // A socket and the lamp above it are this device's configuration, which
        // is `manage` where the device stands.
        const mayManage = enough(mayWith(device), 'manage');

        const plugs = (list: SocketRowModel[]) =>
          list.map(row => (
            <SocketRow
              key={row.key}
              row={row}
              deviceId={device.id}
              refusal={refusal}
              unheard={unheard}
              mayManage={mayManage}
              runs={runsOf(verdict, row.role)}
              now={now}
            />
          ));

        return (
          <Fragment key={device.id}>
            {light || lamps.length > 0 ? (
              <section className={styles.section}>
                <span className="label">
                  {t('devices.lights')} · {place}
                </span>
                {refusal && mayManage && lamps.length > 0 ? <p className={ui.note}>{refusal}</p> : null}
                <ul className={styles.rows}>
                  {light ? <LightOutputRow output={light} unheard={unheard} mayManage={mayManage} runs={runsOf(verdict, 'light')} now={now} /> : null}
                  {plugs(lamps)}
                </ul>
              </section>
            ) : null}

            {rest.length > 0 ? (
              <section className={styles.section}>
                <span className="label">
                  {t('devices.sockets')} · {place}
                </span>
                {refusal && mayManage ? <p className={ui.note}>{refusal}</p> : null}
                <ul className={styles.rows}>{plugs(rest)}</ul>
              </section>
            ) : null}
          </Fragment>
        );
      })}

      {tables.isPending ? <p className={ui.note}>{t('devices.readingSockets')}</p> : null}
      {tables.isError ? <p className={ui.note}>{t('devices.socketsFailed')}</p> : null}
    </div>
  );
}

/** A list of rows under its label, with the one way of adding to it beside that label where there is one. */
function Section({ label, empty, action, children }: { label: string; empty: string | null; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="label">{label}</span>
        {action}
      </div>
      {empty ? <p className={`${ui.cardDashed} ${ui.note}`}>{empty}</p> : <ul className={styles.rows}>{children}</ul>}
    </section>
  );
}

interface DeviceRowProps {
  device: Device;
  place: string | null;
  sockets: SocketPage | undefined;
  cameras: number;
  /** The tent's own list is already in the tent, so a row there does not offer the way back to it. */
  linked: boolean;
  now: DateTime;
}

/** A controller: where it stands, what it runs, how much it drives, and how long ago it last said anything. */
function DeviceRow({ device, place, sockets, cameras, linked, now }: DeviceRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const firmwares = useDeviceFirmwares(device.id, open);
  const liveness = deviceLiveness(device.state.lastSeenAt, now);
  const legacy = sockets ? !sockets.capabilities.socketOverride : false;

  // What the row says about the device, in the order it would be missed: the
  // line is one line, and what does not fit is in the panel behind the chevron.
  // The build's id is last because it is the one fact that is an opaque uuid.
  const line = [
    place,
    sockets && sockets.items.length > 0 ? t('devices.socketCount', { count: sockets.items.length }) : null,
    cameras > 0 ? t('devices.camCount', { count: cameras }) : null,
    legacy ? t('devices.legacy') : null,
    device.state.firmwareId ? t('devices.firmware', { version: device.state.firmwareId }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const build = firmwares.data?.items.find(one => one.id === device.state.firmwareId);

  return (
    <li className={`${ui.card} ${styles.row}`}>
      <div className={styles.rowHead}>
        <Cpu className={styles.rowIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{deviceTitle(device, t)}</span>
          <span className={styles.rowNote}>{line}</span>
        </div>
        <span className={`mono ${styles.liveness}`} data-liveness={liveness}>
          <span className={styles.dot} aria-hidden />
          {t(`home.liveness.${liveness}`)}
          {device.state.lastSeenAt ? ` · ${ageLabel(device.state.lastSeenAt, now)}` : ''}
        </span>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={t('devices.details', { name: deviceTitle(device, t) })}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={16} strokeWidth={2} aria-hidden /> : <ChevronRight size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>

      {open ? (
        <Facts>
          <Fact label={t('devices.fact.id')} value={device.id} />
          <Fact label={t('devices.fact.type')} value={device.type} />
          <Fact
            label={t('devices.fact.build')}
            value={build ? (build.name ?? build.version) : firmwares.isPending ? t('home.waiting') : (device.state.firmwareId ?? '—')}
          />
          <Fact label={t('devices.fact.channel')} value={t(`devices.channel.${device.firmware.channel}`)} />
          {sockets ? <Fact label={t('devices.fact.can')} value={capabilityLine(t, sockets)} /> : null}
          {place && linked && device.spaceId ? (
            <Fact
              label={t('devices.fact.place')}
              value={
                <Link className={styles.placeLink} to={`/spaces/${device.spaceId}/devices`}>
                  {place}
                  <ChevronRight size={12} strokeWidth={2} aria-hidden />
                </Link>
              }
            />
          ) : null}
        </Facts>
      ) : null}
    </li>
  );
}

interface CameraRowProps {
  camera: Camera;
  place: string | null;
  devices: Device[];
  /** The newest picture, which is the row's thumbnail; null until one has been read. */
  stillId: string | null;
  now: DateTime;
}

/** A camera opens its page; the row says how it is reached and when it last delivered. */
function CameraRow({ camera, place, devices, stillId, now }: CameraRowProps) {
  const { t } = useTranslation();
  const carrier = devices.find(device => device.id === camera.deviceId) ?? null;
  const through = carrier ? deviceName(carrier, t) : null;
  const freshness = cameraFreshness(camera, now);

  const line = [
    camera.kind === 'terpcam_controller'
      ? t('devices.via', { name: through ?? t('devices.type.controller') })
      : t(`devices.cameraKind.${camera.kind}`),
    place,
    camera.looksAt,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={`${ui.card} ${styles.row}`}>
      <Link className={styles.rowHead} to={`/cameras/${camera.id}`}>
        <Thumb stillId={stillId} />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{cameraTitle(camera, carrier, t)}</span>
          <span className={styles.rowNote}>{line}</span>
          {camera.kind === 'rtsp' ? <span className={styles.premium}>{t('devices.premium')}</span> : null}
        </div>
        <span className={`mono ${styles.since}`} {...ageAttribute(freshness)}>
          {camera.state.lastStillAt ? t('devices.ago', { age: ageLabel(camera.state.lastStillAt, now) }) : t('devices.noStill')}
        </span>
        <ChevronRight className={styles.chevron} size={16} strokeWidth={2} aria-hidden />
      </Link>
    </li>
  );
}

function Thumb({ stillId }: { stillId: string | null }) {
  const source = stillId ? mediaUrl(stillId, THUMBNAIL_WIDTH.still) : null;

  return source ? (
    <img className={styles.thumb} src={source} alt="" />
  ) : (
    <span className={styles.thumb} aria-hidden>
      <CameraIcon size={16} strokeWidth={1.75} />
    </span>
  );
}

/** Live first, then the ones that have gone quiet; two of a kind keep the order the server gave them. */
const RANK: Record<ValueState, number> = { live: 0, stale: 1, offline: 2 };

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What the build announced it takes. A build that announced nothing is sent nothing new, and this is where that is read. */
const capabilityLine = (t: Translate, sockets: SocketPage): string => {
  const can = [
    sockets.capabilities.socketOverride ? t('devices.can.override') : null,
    sockets.capabilities.socketTimer ? t('devices.can.timer') : null,
    sockets.capabilities.lightOverride ? t('devices.can.light') : null,
  ].filter(Boolean);

  return can.length > 0 ? can.join(' · ') : t('devices.can.nothing');
};

/** The outputs a socket role drives, where the tent's day has already been read. */
const ROLE_OUTPUT: Partial<Record<SocketRole, OutputMetric>> = {
  heater: 'heater',
  dehumidifier: 'dehumidifier',
  co2: 'co2',
  light: 'light',
  fan: 'fan',
};

const runsOf = (verdict: ClimateVerdict | undefined, role: SocketRole): ActuatorRuns | null => {
  const output = ROLE_OUTPUT[role];

  return (output && verdict?.actuators.find(one => one.output === output)) || null;
};
