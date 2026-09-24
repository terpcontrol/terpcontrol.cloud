import { Camera as CameraIcon, ChevronDown, ChevronRight, Cpu, Pencil } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ActuatorRuns, Camera, ClimateVerdict, Device, Firmware, OutputMetric, SocketPage, SocketRole, ValueState } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useMe } from '@/api/account';
import { useCameras, useLatestStills } from '@/api/cameras';
import { fetchedAt } from '@/api/clock';
import { useDeviceFirmwares, useDevices, useLiveReads, useSocketTables } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces, useSpaceVerdicts } from '@/api/spaces';
import { ageAttribute, ageLabel, deviceLiveness, heardAt } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, useMayLogIn, useMayManage, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { cameraFreshness } from './cameras';
import { DeviceSettingsSheet } from './DeviceSettingsSheet';
import { Fact, Facts } from './Facts';
import { isLightRole, lightOutputOf } from './lights';
import { LightOutputRow } from './LightOutputRow';
import { cameraTitle, deviceName, deviceTitle } from './naming';
import { rowsOf, type SocketRowModel } from './sockets';
import { SocketRow } from './SocketRow';
import settings from './DeviceSettings.module.css';
import styles from './Devices.module.css';

/**
 * Everything this account has standing somewhere: the controllers, the cameras
 * - through a controller, standalone, or a stream this cloud pulls - and every
 * smart socket with its role and its switch.
 *
 * The tent page shows the same list narrowed to one place, which is why this is
 * a component and not a screen: the Devices tab is this with a header over it.
 */
export function DeviceList({ spaceId }: { spaceId?: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const { user } = useSession();
  // Whether Premium is charged for at all is the account's answer and not the
  // camera's: every camera carries a tier whatever install it stands on, and
  // only `/me` says whether that tier costs anything here. Read once for the
  // whole list, and already cached by Me and by a camera's own page. The demo
  // has no account to ask, and `!== false` keeps the tag while the answer is
  // still on its way rather than flashing it in a moment later.
  const me = useMe(false, user?.isDemo !== true);
  const charged = me.data?.premium.enforced !== false;
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

  const here = (devices.data?.items ?? []).filter(device => spaceId === undefined || device.spaceId === spaceId);
  // What each controller is reading and what its lamp is running at. The level
  // is a reading and not a setting, and it is the only word the device gives on
  // its own light output: a brightness is never acknowledged and an override is
  // never reported back. The instants come with it, because a reading is proof
  // the device was heard and the migrated `lastSeenAt` of a device claimed into
  // the old cloud can be older than its own samples.
  const reads = useLiveReads(here.map(device => device.id));
  const spokeAt = (device: Device): string | null => heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null);
  // The device that is talking is the one somebody came here for; one that has
  // gone quiet keeps its row, its place and its age, further down.
  const mine = [...here].sort((one, other) => RANK[deviceLiveness(spokeAt(one), now)] - RANK[deviceLiveness(spokeAt(other), now)]);
  const shown = cameras.data?.items ?? [];
  const tables = useSocketTables(mine.map(device => device.id));
  const stills = useLatestStills(shown.map(camera => camera.id));
  // How often an output came on today is counted per place, so the list asks
  // each place it draws a row from rather than only the one it was opened in.
  // On a tent's own tab that is the overview the page above this has already
  // read, under the same key; on the account-wide tab it is what used to be
  // missing, and the panels there ended at "Running at" with nothing saying
  // why.
  const verdicts = useSpaceVerdicts([...new Set(mine.map(device => device.spaceId).filter((id): id is string => id !== null))]);

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

      {/* "Devices" and not "Controllers": this list holds whatever the account
          has claimed - a light, a fan and a smart socket among them - and each
          row says what it is on its own title. Calling a socket a controller
          also collided with the Smart sockets sections further down, which hold
          something else. */}
      {/* What the account has, and what those things drive: two columns on a
          wide Devices tab, one run of sections everywhere else. */}
      <div className={styles.column}>
        <Section label={t('devices.controllers')} empty={mine.length === 0 ? t(maySetUp ? 'devices.noDevices' : 'devices.noDevicesHere') : null}>
          {mine.map(device => (
            <DeviceRow
              key={device.id}
              device={device}
              place={placeOf(device.spaceId)}
              sockets={tables.tables.get(device.id)}
              cameras={shown.filter(camera => camera.deviceId === device.id).length}
              linked={spaceId === undefined}
              spokeAt={spokeAt(device)}
              now={now}
            />
          ))}
        </Section>

        {/* A claim always makes a place of its own, so this is offered on the tab
          that shows everything and not on a tent's list, where it would read as
          adding a device to that tent. */}
        {spaceId === undefined && maySetUp ? (
          <Link className={ui.addRow} to="/claim">
            + {t('claim.addDevice')}
          </Link>
        ) : null}

        <Section label={t('devices.cameras')} empty={shown.length === 0 ? t('devices.noCameras') : null}>
          {shown.map(camera => (
            <CameraRow
              key={camera.id}
              camera={camera}
              place={placeOf(camera.spaceId)}
              devices={devices.data!.items}
              stillId={stills.get(camera.id) ?? null}
              charged={charged}
              now={now}
            />
          ))}
        </Section>

        {/* Only on the Devices tab: a tent's own list is the same component,
            and the screen behind this asks which place a camera is for rather
            than taking the one it was opened from. It closes the list it adds
            to, as the way to add a device closes that one. */}
        {maySetUp && spaceId === undefined ? (
          <Link className={ui.addRow} to="/cameras/add">
            + {t('cameras.add.title')}
          </Link>
        ) : null}
      </div>

      <div className={`${styles.column} ${styles.outputs}`}>
        {mine.map(device => {
          const table = tables.tables.get(device.id);
          if (!table) return null;

          // What lights the tent stands apart from what else is plugged in, and
          // the controller's own output stands at the head of it: a grower asking
          // "why is it dark in there" is asking about one of these rows, and which
          // of them it is is the question this screen used to leave open.
          const rows = rowsOf(table.items);
          const light = lightOutputOf(device, table.capabilities, reads.levels.get(device.id) ?? null);
          const lamps = rows.filter(row => isLightRole(row.role));
          const rest = rows.filter(row => !isLightRole(row.role));
          if (!light && rows.length === 0) return null;

          // Why none of the sockets can be switched, said once per list: it is
          // true of the device and not of a row, and repeating it eight times is
          // noise. A device nobody is listening on hears nothing at all; one whose
          // build predates the override still takes every command it always did,
          // so that reason is kept apart from this one.
          //
          // Both are said where both are true, and the silence comes first. Only
          // the older build was ever drawn, and because no device restored from
          // the old cloud announces what it can do, a fridge that had been
          // unplugged for four days told its owner to wait for a firmware update
          // and never once said it was offline - while the light output printed
          // directly above it, which works this out for itself, said so plainly.
          // Being unreachable stops strictly more than an old build does,
          // including the one command every build in the field still takes.
          const unheard = deviceLiveness(spokeAt(device), now) === 'offline' ? t('devices.socket.offline') : null;
          const needsFirmware = !table.capabilities.socketOverride ? t('devices.socket.needsFirmware') : null;
          const refusal = unheard ?? needsFirmware;
          const refusals = [unheard, needsFirmware].filter((one): one is string => one !== null);
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
                runs={runsOf(verdicts.get(device.spaceId ?? ''), row.role)}
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
                  {mayManage && lamps.length > 0
                    ? refusals.map(one => (
                        <p key={one} className={ui.note}>
                          {one}
                        </p>
                      ))
                    : null}
                  <ul className={ui.group}>
                    {light ? (
                      <LightOutputRow
                        output={light}
                        unheard={unheard}
                        mayManage={mayManage}
                        runs={runsOf(verdicts.get(device.spaceId ?? ''), 'light')}
                        now={now}
                      />
                    ) : null}
                    {plugs(lamps)}
                  </ul>
                </section>
              ) : null}

              {rest.length > 0 ? (
                <section className={styles.section}>
                  <span className="label">
                    {t('devices.sockets')} · {place}
                  </span>
                  {mayManage
                    ? refusals.map(one => (
                        <p key={one} className={ui.note}>
                          {one}
                        </p>
                      ))
                    : null}
                  <ul className={ui.group}>{plugs(rest)}</ul>
                </section>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      {tables.isPending ? <p className={ui.note}>{t('devices.readingSockets')}</p> : null}
      {tables.isError ? <p className={ui.note}>{t('devices.socketsFailed')}</p> : null}
    </div>
  );
}

/** A list of rows under its label. */
function Section({ label, empty, children }: { label: string; empty: string | null; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className="label">{label}</span>
      </header>
      {empty ? <p className={`${ui.cardDashed} ${ui.note}`}>{empty}</p> : <ul className={ui.group}>{children}</ul>}
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
  /** When the device was last heard, which is its own last message or its own newest reading, whichever is later. */
  spokeAt: string | null;
  now: DateTime;
}

/** A controller: where it stands, what it runs, how much it drives, and how long ago it last said anything. */
function DeviceRow({ device, place, sockets, cameras, linked, spokeAt, now }: DeviceRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const firmwares = useDeviceFirmwares(device.id, open);
  const liveness = deviceLiveness(spokeAt, now);
  // Old is said only of a type that drives sockets at all: a plug, a fan or a
  // light announces no override because it has nothing to override, on its
  // newest build as on its first.
  const drivesSockets = SOCKET_HOST_TYPES.includes(device.type);
  const legacy = drivesSockets && sockets ? !sockets.capabilities.socketOverride : false;
  // Naming a device and moving it are both `manage`, and asked of this device
  // rather than of the screen: the whole-account list draws rows from every
  // place at once, and the same reader owns one tent and only reads the next.
  const mayCorrect = enough(useMayWith()(device), 'manage');

  const build = firmwares.data?.items.find(one => one.id === device.state.firmwareId);

  // What the row says about the device, in the order it would be missed: the
  // line is one line, and what does not fit is in the panel behind the chevron.
  //
  // The build is named and never identified. What the hardware reports is the
  // uuid its build container stamped, which is three lines of hex to a grower
  // and cannot be compared with anything, so the build list is what turns it
  // into something readable - and until that list has been read, the segment is
  // left out rather than printed as the uuid it is. The list is one request per
  // class and is fetched when the panel opens, which is where this fact is
  // wanted; asking for it on first paint would be one request per row.
  const line = [
    place,
    sockets && sockets.items.length > 0 ? t('devices.socketCount', { count: sockets.items.length }) : null,
    cameras > 0 ? t('devices.camCount', { count: cameras }) : null,
    legacy ? t('devices.legacy') : null,
    buildLabel(build) ? t('devices.firmware', { version: buildLabel(build) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className={`${ui.card} ${styles.row}`}>
      <div className={styles.rowHead}>
        <Cpu className={styles.rowIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{deviceTitle(device, t)}</span>
          <span className={styles.rowNote}>{line}</span>
        </div>
        <span className={ui.live} data-liveness={liveness}>
          <span className={ui.liveDot} aria-hidden />
          {t(`home.liveness.${liveness}`)}
          {spokeAt ? ` · ${ageLabel(spokeAt, now)}` : ''}
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
        <>
          <Facts>
            <Fact label={t('devices.fact.id')} value={device.id} />
            {/* Through the catalogue, like the thirteen other places that print a
                type: it is a contract key and not a word, so drawn as it stands
                it reads as lowercase English under a row title the German app has
                already translated. A type from a newer contract than this build
                still prints, rather than showing a missing key. */}
            <Fact label={t('devices.fact.type')} value={t(`devices.type.${device.type}`, { defaultValue: device.type })} />
            <Fact label={t('devices.fact.build')} value={buildLabel(build) ?? (firmwares.isPending ? t('home.waiting') : '—')} />
            <Fact label={t('devices.fact.channel')} value={t(`devices.channel.${device.firmware.channel}`)} />
            {drivesSockets && sockets ? <Fact label={t('devices.fact.can')} value={capabilityLine(t, sockets)} /> : null}
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

          {/* Beside the facts it corrects, which is where the name and the place
              are read: the panel is the only screen in the app a device has of
              its own, and both of these were until now the claim flow's alone -
              the name not even there. */}
          {mayCorrect ? (
            <button type="button" className={`${ui.chip} ${settings.open}`} onClick={() => setNaming(true)}>
              <Pencil size={13} strokeWidth={1.75} aria-hidden />
              {t('devices.settings.open')}
            </button>
          ) : null}
        </>
      ) : null}

      {naming ? <DeviceSettingsSheet device={device} onClose={() => setNaming(false)} /> : null}
    </li>
  );
}

interface CameraRowProps {
  camera: Camera;
  place: string | null;
  devices: Device[];
  /** The newest picture, which is the row's thumbnail; null until one has been read. */
  stillId: string | null;
  /** Whether this install charges for Premium, which is what makes the feature tag worth drawing. */
  charged: boolean;
  now: DateTime;
}

/** A camera opens its page; the row says how it is reached and when it last delivered. */
function CameraRow({ camera, place, devices, stillId, charged, now }: CameraRowProps) {
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
          {/* The tag is on the feature rather than on this camera - a stream the
              cloud pulls is what Premium buys - so it is drawn from the kind and
              never from the camera's own tier, which would tag every migrated
              camera. On an install that charges nothing it is not drawn at all:
              the word would point a grower at a paywall that is not there, and
              the camera's own page one tap away already says so. */}
          {camera.kind === 'rtsp' && charged ? <span className={styles.premium}>{t('devices.premium')}</span> : null}
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

/**
 * Which build a device is on, in the words that say which one.
 *
 * `version` comes first because it is the only field that tells two builds of
 * one class apart: the build container stamps it with the commit and the branch
 * it came from, while every build carried over from the old cloud is *named*
 * after its class, so two fridges on two different builds both read "fridge".
 * With neither there is nothing to say, and nothing is said - the uuid the
 * device reports means nothing to a grower and cannot be compared with
 * anything.
 */
const buildLabel = (build: Firmware | undefined): string | null => build?.version || build?.name || null;

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
