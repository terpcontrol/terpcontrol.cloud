import { Camera as CameraIcon, ChevronDown, ChevronRight, Cpu, Pencil } from 'lucide-react';
import { DateTime } from 'luxon';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath, placePath } from '@/app/places';
import type { ActuatorRuns, Camera, ClimateVerdict, Device, Firmware, OutputMetric, SocketPage, SocketRole, ValueState } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useCameras, useLatestStills } from '@/api/cameras';
import { fetchedAt, serverNow } from '@/api/clock';
import { useDeviceFirmwares, useDevices, useLiveReads, useSocketTables } from '@/api/devices';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { useSpaces, useSpaceVerdicts } from '@/api/spaces';
import { ageAttribute, ageLabel, deviceLiveness, offlineLabel } from '@/ui/age';
import { useReportFreshness } from '@/ui/freshness';
import { Help, Term } from '@/ui/Help';
import { maintenanceQuiet, parksAnything } from '@/ui/maintenance';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, useMayManage, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { calendarDay, clock, useZone } from '@/ui/zone';
import { ownFactOf } from '@/screens/control/devices/own-summary';
import { offsetOf } from '@/screens/control/targets/targets-draft';
import { clockLabel } from '@/screens/notifications/settings';
import { cameraFreshness } from './cameras';
import { DeviceAdvanced } from './DeviceAdvanced';
import { DeviceSettingsSheet } from './DeviceSettingsSheet';
import { movesAnywhere } from './moving';
import { Fact, Facts } from './Facts';
import { isLightRole, lightOutputOf } from './lights';
import { LightOutputRow } from './LightOutputRow';
import { ControlButton } from './ControlSwitch';
import { MaintenanceButton, RebootButton } from './Maintenance';
import { cameraTitle, deviceName, deviceTitle } from '@/ui/naming';
import { rowsOf, type SocketRowModel } from './sockets';
import { SocketRow } from './SocketRow';
import { PairSocketRow } from './SocketSheets';
import socketStyles from './Sockets.module.css';
import { AutoUpdate } from './Updates';
import settings from './DeviceSettings.module.css';
import styles from './Devices.module.css';

/**
 * Everything this account has standing somewhere: the controllers, the cameras
 * - through a controller, standalone, or a stream this cloud pulls - and every
 * smart socket with its role and its switch.
 *
 * The Devices tab is this with a header over it. `opened` names a place whose
 * devices are drawn open, which is what a link about that place - the offline
 * box on its cockpit, an old address of its devices tab - asks for: the row
 * that says since when it has been quiet and what to try.
 */
export function DeviceList({ opened = null }: { opened?: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  // The whole-account list draws rows from every place at once, so what may be
  // done is asked of the row and not of the screen: the same reader owns one
  // tent and only writes lines in the next, and the sockets of the two must not
  // look alike. Claiming makes a place of its own and belongs to the session.
  const mayWith = useMayWith();
  const maySetUp = useMayManage();
  const devices = useDevices();
  const cameras = useCameras();
  const spaces = useSpaces();

  const here = devices.data?.items ?? [];
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
  // The first device whose sockets are listed, and the first whose own light is, in the order they are drawn.
  const socketTeacher =
    mine.find(device => {
      const table = tables.tables.get(device.id);
      return table ? rowsOf(table.items).some(row => !isLightRole(row.role)) : false;
    })?.id ?? null;
  const lightTeacher =
    mine.find(device => {
      const table = tables.tables.get(device.id);
      return table ? lightOutputOf(device, table.capabilities, reads.levels.get(device.id) ?? null) !== null : false;
    })?.id ?? null;
  // How often an output came on today is counted per place, so the list asks
  // each place it draws a row from - under the key the cockpit reads the same
  // overview by, so a place already looked at costs nothing more.
  const verdicts = useSpaceVerdicts([...new Set(mine.map(device => device.spaceId).filter((id): id is string => id !== null))]);

  useReportFreshness(devices.dataUpdatedAt ? fetchedAt(devices.dataUpdatedAt) : null);

  if (devices.isPending || cameras.isPending) return <Waiting lines={3} />;
  if (!devices.data || !cameras.data) return <LoadFailed retry={() => void devices.refetch()} />;

  const placeOf = (id: string | null): string | null => spaces.data?.items.find(space => space.id === id)?.name ?? null;
  const failedAt = devices.isError || cameras.isError ? devices.dataUpdatedAt : null;

  return (
    <div className={styles.list}>
      <RefreshFailed failedAt={failedAt} now={now} />

      {/* The switches below are simply gone on the devices of a place somebody
          may only write lines in, and a list of rows with nothing to press is
          the kind of absence that reads as a fault. */}
      {mine.some(device => !enough(mayWith(device), 'manage')) ? <p className={`mono ${styles.role}`}>{t('devices.youMayLog')}</p> : null}

      {/* "Devices" and not "Controllers": this list holds whatever the account
          has claimed - a light, a fan and a smart socket among them - and each
          row says what it is on its own title. Calling a socket a controller
          also collided with the Smart sockets sections further down, which hold
          something else. */}
      {/* What the account has, and what those things drive: two columns on a
          wide Devices tab, one run of sections everywhere else. */}
      <div className={styles.column}>
        {/* Without a device the tab is the door hardware comes in by, not a list
            with nothing in it: what is there - a camera - comes first, and the
            two ways in follow as rows of the same weight. */}
        {mine.length === 0 && maySetUp ? null : (
          <Section
            label={t('devices.controllers', { count: mine.length })}
            empty={mine.length === 0 ? t(maySetUp ? 'devices.noDevices' : 'devices.noDevicesHere') : null}
          >
            {mine.map((device, index) => (
              <DeviceRow
                key={device.id}
                explain={index === 0}
                device={device}
                among={devices.data!.items}
                place={placeOf(device.spaceId)}
                sockets={tables.tables.get(device.id)}
                cameras={shown.filter(camera => camera.deviceId === device.id).length}
                startOpen={opened !== null && device.spaceId === opened}
                spokeAt={spokeAt(device)}
                now={now}
              />
            ))}
          </Section>
        )}

        {/* A claim always makes a place of its own, so this is offered on the tab
          that shows everything and not on a tent's list, where it would read as
          adding a device to that tent. */}
        {maySetUp && mine.length > 0 ? (
          <Link className={ui.addRow} to="/claim">
            + {t('claim.addDevice')}
          </Link>
        ) : null}
        {maySetUp && mine.length === 0 && shown.length === 0 ? <p className={ui.note}>{t('devices.noneYet')}</p> : null}

        {/* No camera, no section: an empty box between the device and its light
            said nothing to somebody who never had one, and read as something
            missing. The way to add one is then a single small line. */}
        {shown.length > 0 ? (
          <Section label={t('devices.cameras')} empty={null}>
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
        ) : null}

        {/* Only on the Devices tab: a tent's own list is the same component,
            and the screen behind this asks which place a camera is for rather
            than taking the one it was opened from. */}
        {maySetUp ? (
          shown.length > 0 || mine.length === 0 ? (
            <Link className={ui.addRow} to="/cameras/add">
              + {t('cameras.add.title')}
            </Link>
          ) : (
            <Link className={`${ui.headLink} ${styles.addCamera}`} to="/cameras/add">
              + {t('cameras.add.title')}
            </Link>
          )
        ) : null}
        {maySetUp && mine.length === 0 ? (
          <Link className={ui.addRow} to="/claim">
            + {t('devices.addController')}
          </Link>
        ) : null}
      </div>

      <div className={`${styles.column} ${styles.outputs}`}>
        {mine.map(device => {
          // What a socket's role is, and what the light's brightness and hold do,
          // are said on the first list of each and on no other.
          const explainSockets = device.id === socketTeacher;
          const explainLight = device.id === lightTeacher;
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
          const place = placeOf(device.spaceId) ?? deviceTitle(device, t, devices.data!.items);
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
                capabilities={table.capabilities}
                deviceName={deviceTitle(device, t, devices.data!.items)}
              />
            ));

          // Pairing another socket by its address, under the last list of this
          // device's sockets; a device with none yet has it in its own panel.
          const pairing =
            mayManage && SOCKET_HOST_TYPES.includes(device.type) && rows.length > 0 ? (
              <details className={socketStyles.listAdvanced}>
                {/* Named for what it holds: right under a socket's own Erweitert, a second one said nothing of which was which. */}
                <summary className="label">{t('socketForm.pair.another')}</summary>
                <PairSocketRow deviceId={device.id} deviceName={deviceTitle(device, t, devices.data!.items)} capabilities={table.capabilities} />
              </details>
            ) : null;

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
                        explain={explainLight}
                        output={light}
                        spaceId={device.spaceId}
                        unheard={unheard}
                        mayManage={mayManage}
                        runs={runsOf(verdicts.get(device.spaceId ?? ''), 'light')}
                        now={now}
                      />
                    ) : null}
                    {plugs(lamps)}
                  </ul>
                  {rest.length === 0 ? pairing : null}
                </section>
              ) : null}

              {rest.length > 0 ? (
                <section className={styles.section}>
                  <span className="label">
                    {t('devices.sockets')} · {place}
                    {explainSockets ? <Help topic="socketRoles" /> : null}
                  </span>
                  {mayManage
                    ? refusals.map(one => (
                        <p key={one} className={ui.note}>
                          {one}
                        </p>
                      ))
                    : null}
                  <ul className={ui.group}>{plugs(rest)}</ul>
                  {pairing}
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
  /** Every device of the account, which is what says whether this one's name needs the tail of its id. */
  among: Device[];
  place: string | null;
  sockets: SocketPage | undefined;
  cameras: number;
  /** When the device was last heard, which is its own last message or its own newest reading, whichever is later. */
  spokeAt: string | null;
  now: DateTime;
  /** The first row on the page, whose liveness pill says what live and stale mean. */
  explain: boolean;
  /** Whether the row opens drawn open: a link about the place it stands in asked for it. */
  startOpen?: boolean;
}

/**
 * A controller: where it stands, what it runs, how much it drives, and how long
 * ago it last said anything - and, opened, the device in plain words and the
 * two things done to the hardware itself.
 *
 * The whole head opens it, not only the chevron: a tap on the name used to do
 * nothing at all. The chevron stays the control a keyboard and a screen reader
 * use, and the click it receives is the head's own.
 */
function DeviceRow({ device, among, place, sockets, cameras, spokeAt, now, explain, startOpen = false }: DeviceRowProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const [open, setOpen] = useState(startOpen);
  const [naming, setNaming] = useState(false);
  const firmwares = useDeviceFirmwares(device.id, open);
  const liveness = deviceLiveness(spokeAt, now);
  const offline = liveness === 'offline';
  const title = deviceTitle(device, t, among);
  const quiet = maintenanceQuiet(device, DateTime.max(now, serverNow()));
  // What a build takes is said only of a type that drives sockets at all: a
  // plug, a fan or a light announces no override because it has nothing to
  // override.
  const drivesSockets = SOCKET_HOST_TYPES.includes(device.type);
  // Naming a device, moving it and sending it a command are all `manage`, and
  // asked of this device rather than of the screen: the whole-account list
  // draws rows from every place at once, and the same reader owns one tent and
  // only reads the next.
  const may = useMayWith()(device);
  const mayCorrect = enough(may, 'manage');
  // Moving is offered only where there is somewhere to move to.
  const movable = movesAnywhere(useSpaces().data?.items ?? [], device);

  // What a socket, a fan or a lamp is set to, with the way to Steuerung where it is changed.
  const own = ownFactOf(t, device, offsetOf(now, zone));
  const build = firmwares.data?.items.find(one => one.id === device.state.firmwareId);
  // A build the device has been pinned to and is not running yet. The diary
  // says when it was asked and whether it took; the device's own panel is
  // where somebody looks for it, so it says so too.
  const owedId = device.firmware.targetId && device.firmware.targetId !== device.state.firmwareId ? device.firmware.targetId : null;
  const owedLabel = owedId ? (buildLabel(firmwares.data?.items.find(one => one.id === owedId)) ?? t('devices.update.newBuild')) : null;

  // What the row says about the device, in the order it would be missed: the
  // line is one line, and what does not fit is in the panel behind the chevron.
  const line = [
    place,
    sockets && sockets.items.length > 0 ? t('devices.socketCount', { count: sockets.items.length }) : null,
    cameras > 0 ? t('devices.camCount', { count: cameras }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Connected or not, and since when, in the words the rest of the app uses
  // for it: a stale device is still connected, only late.
  const connection =
    liveness === 'live'
      ? t('devices.panel.connected')
      : liveness === 'stale' && spokeAt
        ? t('devices.panel.connectedLate', { age: ageLabel(spokeAt, now) })
        : spokeAt
          ? t('devices.panel.offlineSince', { time: clockLabel(spokeAt, now, zone) })
          : t('devices.panel.neverHeard');

  // The pill says offline in the words Start and the alerts use for it.
  const pill = offline ? offlineLabel(spokeAt, now, zone) : t(`home.liveness.${liveness}`);

  // The build is named by the day it was made, which is the one thing about it
  // a grower can compare. What the build container stamped it with is a commit
  // and a branch, so that is a technical detail; and until the build list has
  // been read nothing is said rather than the uuid the hardware reports.
  const firmware = build ? (
    t('devices.panel.firmwareFrom', { day: calendarDay(build.createdAt, zone) })
  ) : firmwares.isPending ? (
    t('home.waiting')
  ) : firmwares.isError ? (
    // A read that failed is not a build nobody knows, so it does not say the same.
    <>
      {t('devices.buildUnread')}{' '}
      <button type="button" className={ui.chip} onClick={() => void firmwares.refetch()}>
        {t('home.retry')}
      </button>
    </>
  ) : (
    t('devices.panel.firmwareUnknown')
  );

  return (
    <li className={`${ui.card} ${styles.row}`}>
      <div className={styles.rowHead} data-opens onClick={() => setOpen(!open)}>
        <Cpu className={styles.rowIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          {line ? <span className={styles.rowNote}>{line}</span> : null}
          {/* "offline seit 1. Okt 10:19" took the width the name needs on a phone, and a
              tap on it opened its explanation rather than the row: under the name, it is
              part of the row. */}
          {offline ? (
            <span className={`${ui.live} ${styles.rowLive}`} data-liveness={liveness}>
              <span className={ui.liveDot} aria-hidden />
              {pill}
            </span>
          ) : null}
        </div>
        {offline ? null : (
          <span className={ui.live} data-liveness={liveness}>
            <span className={ui.liveDot} aria-hidden />
            {explain ? <Term topic="liveness">{pill}</Term> : pill}
            {spokeAt ? ` · ${ageLabel(spokeAt, now)}` : ''}
          </span>
        )}
        <button type="button" className={styles.expand} aria-expanded={open} aria-label={t('devices.details', { name: title })}>
          {open ? <ChevronDown size={16} strokeWidth={2} aria-hidden /> : <ChevronRight size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>

      {open ? (
        <div className={styles.panel}>
          <Facts>
            <Fact label={t('devices.panel.connection')} value={connection} />
            {device.control ? <Fact label={t('climateControl.label')} value={t(`climateControl.state.${controlState(device.control)}`)} /> : null}
            {own && device.spaceId ? (
              <Fact
                label={own.label}
                value={
                  <Link className={styles.placeLink} to={controlPath(device.spaceId)}>
                    {own.value}
                    <ChevronRight size={12} strokeWidth={2} aria-hidden />
                  </Link>
                }
              />
            ) : null}
            <Fact label={t('devices.panel.firmware')} value={firmware} />
            {owedId ? (
              <Fact
                label={t('devices.fact.update')}
                value={
                  device.state.updateFailedAt
                    ? t('devices.panel.updateFailed', { ago: t('devices.ago', { age: ageLabel(device.state.updateFailedAt, now) }) })
                    : t('devices.panel.updateOwed')
                }
              />
            ) : null}
            {/* Whoever may change it is given the switch below instead. */}
            {mayCorrect ? null : (
              <Fact
                label={
                  <>
                    {t('devices.fact.channel')}
                    <Help topic="firmwareChannel" />
                  </>
                }
                value={t(`devices.panel.channel.${device.firmware.channel}`)}
              />
            )}
            {place && device.spaceId ? (
              <Fact
                label={t('devices.fact.place')}
                value={
                  <Link className={styles.placeLink} to={placePath(device.spaceId)}>
                    {place}
                    <ChevronRight size={12} strokeWidth={2} aria-hidden />
                  </Link>
                }
              />
            ) : null}
          </Facts>

          {mayCorrect && !device.isDemo ? (
            <div className={styles.autoUpdate}>
              <AutoUpdate device={device} />
            </div>
          ) : null}

          {quiet ? (
            <p className={`mono ${styles.quiet}`} role="status">
              {t(quiet.parked ? 'maintenance.parked' : 'maintenance.settling', {
                until: clock(quiet.until, zone),
                alarms: clock(quiet.alarmsUntil, zone),
              })}
            </p>
          ) : null}

          {/* The two things done to the hardware itself, each asked first. A
              device nobody is listening on would hear neither, so they wait
              for it with the reason under them rather than vanishing. */}
          {mayCorrect ? (
            <div className={styles.actions}>
              <span className={styles.withHelp}>
                <RebootButton device={device} name={title} disabled={offline} />
                <Help topic="reboot" />
              </span>
              {parksAnything(device) ? (
                <span className={styles.withHelp}>
                  <MaintenanceButton devices={[device]} now={now} disabled={offline} />
                  <Help topic="maintenance" />
                </span>
              ) : null}
              {device.control ? (
                <span className={styles.withHelp}>
                  <ControlButton device={device} offline={offline} />
                  <Help topic="climateControl" />
                </span>
              ) : null}
            </div>
          ) : null}
          {mayCorrect && offline ? <p className={ui.note}>{t('devices.panel.offlineNote')}</p> : null}

          {/* Beside the facts it corrects, which is where the name and the place
              are read: the panel is the only screen in the app a device has of
              its own. */}
          {mayCorrect ? (
            <button type="button" className={`${ui.chip} ${settings.open}`} onClick={() => setNaming(true)}>
              <Pencil size={13} strokeWidth={1.75} aria-hidden />
              {t(movable ? 'devices.settings.open' : 'devices.settings.openRename')}
            </button>
          ) : null}

          {/* What few growers need about this device, beside what only support
              asks for: drawn only where one of its items applies here. */}
          <DeviceAdvanced device={device} sockets={sockets} offline={offline} />

          {/* What only support asks for: the id printed on the hardware, the
              build as its container stamped it, and what that build takes. */}
          <details className={styles.technical}>
            <summary className="label">{t('devices.panel.technical')}</summary>
            <Facts>
              <Fact label={t('devices.fact.id')} value={device.id} />
              {/* Through the catalogue, like every other place that prints a
                  type: it is a contract key and not a word. A type from a newer
                  contract than this build still prints, rather than a missing key. */}
              <Fact label={t('devices.fact.type')} value={t(`devices.type.${device.type}`, { defaultValue: device.type })} />
              <Fact label={t('devices.fact.build')} value={buildLabel(build) ?? '—'} />
              {owedLabel ? <Fact label={t('devices.fact.owed')} value={owedLabel} /> : null}
              {drivesSockets && sockets ? <Fact label={t('devices.fact.can')} value={capabilityLine(t, sockets)} /> : null}
            </Facts>
          </details>
        </div>
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
  now: DateTime;
}

/** A camera opens its page; the row says how it is reached and when it last delivered. */
function CameraRow({ camera, place, devices, stillId, now }: CameraRowProps) {
  const { t } = useTranslation();
  const carrier = devices.find(device => device.id === camera.deviceId) ?? null;
  const through = carrier ? deviceName(carrier, t) : null;
  const freshness = cameraFreshness(camera, now);

  const line = [
    camera.kind === 'terpcam_controller' && through
      ? t('devices.via', { name: through })
      : // A stream is pulled through a device only where its tunnel is on.
        camera.kind === 'rtsp' && camera.tunnel && through
        ? t('camera.rtspThrough', { device: through })
        : t(`devices.cameraKind.${camera.kind}`),
    // A controller named after the tent it stands in would put the same word
    // twice in a row: "via FG2 · FG2".
    place === through ? null : place,
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

/** Whether a device regulates, and where it does so in a mode that keeps it dark: drying, or germination. */
const controlState = (control: NonNullable<Device['control']>): 'on' | 'off' | 'drying' | 'germination' =>
  !control.running ? 'off' : control.drying ? 'drying' : control.mode === 'germination' ? 'germination' : 'on';
