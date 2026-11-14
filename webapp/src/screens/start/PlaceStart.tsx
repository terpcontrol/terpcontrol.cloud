import { ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useAccountMe } from '@/api/account';
import { useLatestStills } from '@/api/cameras';
import { serverNow } from '@/api/clock';
import { useDiaryLayer } from '@/api/layers';
import { noLongerThere } from '@/api/problem';
import { useHomeShape } from '@/api/home';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { controlPath, devicePath, editPath, GROW, membersPath, timelinePath, usePageOfPlace } from '@/app/places';
import { ageLabel, sinceLabel } from '@/ui/age';
import { BackLink } from '@/ui/BackLink';
import { useCameraCalled } from '@/ui/camera-name';
import { deviceName } from '@/ui/naming';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { LivenessPill } from '@/ui/LivenessPill';
import { maintenanceQuiet, parksAnything, type Quiet } from '@/ui/maintenance';
import { OfflineBox } from '@/ui/OfflineHelp';
import { NoLongerHere, RefreshFailed } from '@/ui/PageState';
import { usePlaceDevices } from '@/ui/place-devices';
import { useMayManage, useVisiting } from '@/ui/session-access';
import { targetWithUnit } from '@/ui/units';
import { useNow } from '@/ui/useNow';
import { offsetOf } from '@/ui/wall-clock';
import { useWideWindow } from '@/ui/wide-window';
import { clock, useZone } from '@/ui/zone';
import { pendingByPath, savedWords } from '@/screens/control/climate/figures';
import { ownStatusOf } from '@/screens/control/devices/own-summary';
import { heldWords } from '@/screens/control/held-light';
import { offNotTaken } from '@/screens/control/rows';
import { MaintenanceControl } from '@/screens/devices/Maintenance';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { EmptyPlace } from '@/screens/space/EmptyPlace';
import { AddPlace } from './AddPlace';
import { judgedAt, judgedBy, livenessThrough, measuredAtOf } from './attention';
import { DayCurves } from './DayCurves';
import { Latest } from './Latest';
import { DeviceOffer, GrowOffer } from './Offers';
import { growPutOff } from './loaded';
import { GrowHead, PhaseLine } from './Phase';
import { OwnPhoto, Picture } from './Picture';
import {
  climateDeviceOf,
  contradictedModeOf,
  controlOffOf,
  openWords,
  ownPhotoOf,
  shownStill,
  statusOf,
  statusText,
  toneOf,
  type HumidifierHold,
  type Status,
} from './place';
import { Menu, MenuLink } from '@/ui/Menu';
import { curvePath, darkOf, extrasOf, readingsOf, type Extra, type Reading } from './readings';
import { ReadingTiles } from './ReadingTiles';
import { usePlace, useHumidifierHold, useLamp, usePlaceAlerts } from './reads';
import { growDay } from '@/screens/grow/progress';
import { DemoBanner, GuestLine, StartFailed, StartWaiting } from './states';
import { Targets } from './Targets';
import { Today } from './Today';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

/**
 * Start of one place, read for what it is opened with: how the plants look,
 * whether everything is all right, what is due, what happened last - and the
 * ways on to what is changed elsewhere. It is the page of `/` for an account
 * with one place and of every place's own address.
 *
 * It waits in its own shape, says plainly where a place has gone, and once it
 * has answered it never goes blank again: a refresh that fails keeps the last
 * answer with its ages.
 */
export function PlaceStart({ spaceId, back = false }: { spaceId: string; back?: boolean }) {
  const { read, current, failedAt } = usePlace(spaceId);

  if (read.isPending) return <StartWaiting />;
  if (!current) {
    return noLongerThere(read.error) ? <NoLongerHere what="space" /> : <StartFailed read={read} />;
  }

  return <Place overview={current} back={back} failedAt={failedAt} />;
}

/** The window standing on any device here: the one still parking hardware first, then one whose alarms are still held. */
const quietOf = (devices: Device[], now: DateTime): Quiet | null => {
  const quiets = devices.map(device => maintenanceQuiet(device, DateTime.max(now, serverNow()))).filter((quiet): quiet is Quiet => quiet !== null);
  return quiets.find(quiet => quiet.parked) ?? quiets[0] ?? null;
};

/** The camera here that delivered last, which is the one the place is shown by. */
const newestCamera = (overview: SpaceOverview): OverviewCamera | null =>
  [...overview.cameras].sort((one, other) => (other.lastStillAt ?? '').localeCompare(one.lastStillAt ?? ''))[0] ?? null;

function Place({ overview, back, failedAt }: { overview: SpaceOverview; back: boolean; failedAt: number | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const wide = useWideWindow();
  const called = useCameraCalled();
  const spaceId = overview.spaceId;
  const hasDevice = overview.deviceIds === null || overview.deviceIds.length > 0;
  const here = usePlaceDevices(spaceId, overview.deviceIds ?? [], hasDevice).items;
  // A place is one climate: the first device the server names as holding one speaks for it.
  const climate = overview.climates[0] ?? null;
  const device = here.find(one => one.id === climate?.deviceId) ?? climateDeviceOf(here, overview.deviceIds);
  const values = climate?.values ?? overview.values;
  const setpoints = climate?.setpoints ?? overview.setpoints;
  const targets = climate?.targets ?? overview.targets;
  const lamp = useLamp(device, here, now);
  const mayManage = useMayManage(spaceId);
  const visiting = useVisiting(spaceId);
  const demo = user?.isDemo === true;
  const me = useAccountMe();
  const space = useSpaces().data?.items.find(one => one.id === spaceId);
  const guest = !demo && !visiting && space !== undefined && user !== null && space.ownerId !== user.id;
  // Whose a shared place is, is told by Start's own read (`home.people`); the place's answer names who wrote in it.
  const hosts = useHomeShape(guest).data?.people ?? [];
  // The grow waits for the account's answer rather than flashing up for somebody who keeps no diary; the demo is shown it whole.
  // Support reading a customer's place is shown the customer's grow where one stands there, whatever its own account keeps.
  const layer = useDiaryLayer() && (me.data !== undefined || demo);
  const diary = visiting ? overview.grows.length > 0 : layer;
  const grow = diary ? (overview.grows[0] ?? null) : null;
  // A second grow started where one already runs: both are shown, the newer under the picture, the other as its card.
  const also = diary ? overview.grows.slice(1) : [];
  // A refresh that fails ages the page, not the device: the place is judged as the last answer left it.
  const judged = judgedAt(now, failedAt);
  // The place lives and falls silent with the device that holds its climate, whatever else of it still reports.
  const judging = judgedBy(values, here, device, judged);
  const liveness = livenessThrough({ values: judging.values, deviceIds: overview.deviceIds }, now, failedAt);
  // No value at all is a device still waiting for its first one - or, where it was heard long ago, one silent since then.
  const silence = judging.silence;
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const waiting = liveness === 'offline' && judging.values.length === 0 && silentSince === null;
  const offline = liveness === 'offline' && !waiting;
  const humidifierHold = useHumidifierHold(device);
  const openAlerts = usePlaceAlerts(overview.openAlerts, here, judged);
  const controlOff = controlOffOf(here);
  // A switch-off the device was not heard to take is a setting it has not been handed: said as Steuerung says it.
  const offStored = device ? offNotTaken(device, pendingByPath(lamp.live?.pending)) : null;
  const quiet = quietOf(here, now);
  const status = statusOf(
    {
      values: judging.values,
      setpoints,
      deviceIds: overview.deviceIds,
      openAlerts,
      leadId: device?.id,
      verdict: climate?.verdict ?? overview.verdict,
      quiet,
      controlOff,
      humidifierHold,
      silentSince,
      mode: contradictedModeOf(device, grow?.stage),
    },
    judged,
  );
  const camera = newestCamera(overview);
  // A diary kept by hand, with nothing here that measures or watches: the grow is the page.
  const kept = !hasDevice && camera === null ? grow : null;
  const byHand = kept !== null;
  const lit = offline ? null : lamp.lit;
  const held = offline ? null : lamp.held;
  const readings = readingsOf(t, { values, setpoints, device, lit, held, hold: humidifierHold, now, zone });
  const extras = offline ? [] : extrasOf(t, overview.values, darkOf(readings, overview.values));
  const measuredAt = measuredAtOf(judging.values) ?? silentSince;
  const ownMedia = kept ? (ownPhotoOf(overview.entries, kept.growId)?.mediaIds[0] ?? kept.coverMediaId) : null;
  const parks = mayManage && !offline && !waiting && here.some(parksAnything);
  const growing = overview.grows.length > 0;
  // Offered once the account and the place have been read, to whoever may start a grow here and has not said no.
  const declined = diary ? space?.presetPrompt === 'never' : me.data?.preferences.diary === 'off';
  const offerGrow =
    !visiting && mayManage && hasDevice && !growing && me.data !== undefined && space !== undefined && !declined && !growPutOff(spaceId, now);
  const offerDevice = byHand && mayManage && me.data !== undefined && me.data.preferences.deviceOfferDeclined !== true;
  const sentence = <StatusSentence status={status} overview={overview} camera={camera} mayManage={mayManage} device={device} parks={parks} />;
  const further = extras.length > 0 ? <Extras spaceId={spaceId} extras={extras} /> : null;
  // Somebody let in who may not manage the place has nothing behind the menu; who else is here is a tap on whose place it is.
  const menu = !demo && !visiting && mayManage;

  // Looking at a place here is what makes it the one Grow, Verlauf and Steuerung open on.
  usePageOfPlace(spaceId);

  return (
    <section className={`${ui.stack3} ${styles.page}`} aria-labelledby={`${spaceId}-name`} data-single={byHand || undefined}>
      {demo ? <DemoBanner /> : null}
      <header className={styles.head}>
        {back ? <BackLink to="/" label={t('shell.tabs.home')} /> : null}
        {/* One name per place: the head is the place's, also where it holds nothing but a grow, and the menu renames what it shows. */}
        <h1 id={`${spaceId}-name`}>{overview.name}</h1>
        {wide ? sentence : null}
        <div className={styles.headEnd}>
          {hasDevice ? <LivenessPill liveness={liveness} measuredAt={measuredAt} now={now} explain waiting={waiting} /> : null}
          {menu ? (
            <span className={styles.menu}>
              {/* A device stands in a place of its owner's, so the owner's ⋯ also adds one here; a guest's leads to the one page. */}
              {space && !guest ? (
                <Menu label={t('grow.menu.label', { name: overview.name })} words={t('grow.menu.more')}>
                  <Link to={editPath(spaceId)}>{t('start.menu.words')}</Link>
                  <Link to={`/claim?space=${encodeURIComponent(spaceId)}`}>{t('home.addDevice.title')}</Link>
                </Menu>
              ) : (
                <MenuLink to={editPath(spaceId)} label={t('start.menu.label', { name: overview.name })} words={t('start.menu.words')} />
              )}
            </span>
          ) : null}
        </div>
      </header>
      {guest && space ? <GuestLine space={space} people={[...overview.people, ...hosts]} to={membersPath(spaceId)} /> : null}
      <RefreshFailed failedAt={failedAt} now={now} />
      {visiting ? <p className={styles.cardText}>{t('start.visiting')}</p> : null}
      {/* Devices moved together leave their old places empty; whether one goes is for its owner to say. */}
      {visiting ? null : <EmptyPlace spaceId={spaceId} />}
      {offline ? (
        <OfflineBox
          title={
            here.length > 1 && device
              ? t('offline.title', { device: deviceName(device, t), time: measuredAt ? sinceLabel(measuredAt, now, zone) : '' })
              : t('start.offline.title', { time: measuredAt ? sinceLabel(measuredAt, now, zone) : '' })
          }
          deviceLink={overview.deviceIds !== null && device ? devicePath(device.id) : null}
        >
          {/* A device that held no targets when it went quiet does not go on holding them. */}
          {offStored && device
            ? t('control.pending.off', { saved: savedWords(t, offStored.savedAt, now, zone), device: deviceName(device, t) })
            : t(controlOff ? 'start.offline.textOff' : 'start.offline.text')}
        </OfflineBox>
      ) : null}

      <div className={`${ui.stack3} ${styles.columns}`}>
        <div className={`${ui.stack3} ${styles.column}`}>
          {camera ? (
            <CameraHead
              camera={camera}
              name={overview.name}
              label={grow ? grow.name : called(camera.name)}
              day={grow ? growDay(t, grow) : null}
              readings={readings}
              curveOf={reading => curvePath(spaceId, reading)}
              age={offline ? 'offline' : liveness === 'stale' ? 'stale' : 'live'}
              // A late device is said by the pill alone; a silent one's figures say as of when they are.
              stand={offline && measuredAt ? t('start.picture.stand', { time: clock(measuredAt, zone), age: ageLabel(measuredAt, now) }) : null}
            />
          ) : null}
          {kept && ownMedia ? <OwnPhoto grow={kept} entries={overview.entries} named /> : null}
          {grow && !camera && !(kept && ownMedia) ? <GrowHead grow={grow} to={GROW} /> : null}
          {/* What only some places measure stands directly under what carries the four readings: the picture, or the tiles. */}
          {camera ? further : null}
          {wide ? null : sentence}
          {/* A work mode the status already says is not said again under it. */}
          {status.kind === 'mode' ? null : <ModeLine device={device} spaceId={spaceId} mayManage={mayManage} humidifierHold={humidifierHold} />}
          {/* "Alles im Ziel" over a lamp somebody holds off would read as a tent keeping its day. */}
          {held && lit ? (
            <p className={styles.mode}>
              <span>
                {t('start.metric.light')} {heldWords(t, held, now, zone)}
              </span>
              {mayManage ? (
                <Link
                  to={controlPath(spaceId, 'outputs', lit.device.id === device?.id ? {} : { device: lit.device.id })}
                  className={styles.modeChange}
                >
                  {t('start.change')} ›
                </Link>
              ) : null}
            </p>
          ) : null}
          {camera || readings.length === 0 ? null : <ReadingTiles spaceId={spaceId} readings={readings} />}
          {camera ? null : further}
          {grow && (camera || (kept && ownMedia)) ? <PhaseLine grow={grow} to={GROW} /> : null}
          {also.map(one => (
            <GrowHead key={one.growId} grow={one} to={`/grows/${one.growId}`} />
          ))}
          {wide && hasDevice && !byHand ? <DayCurves spaceId={spaceId} targets={targets} /> : null}
        </div>

        <div className={`${ui.stack3} ${styles.column}`}>
          {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
          {/* While maintenance pauses the alarms, the control that runs it is the one warning here: that none would reach
              anybody waits until they can fire again. */}
          {visiting || quiet?.parked ? null : <NotifyNotice later />}
          {/* What is due is the reader's own list, and support reading a customer's place is not shown its own work there. */}
          {visiting ? null : <Today spaceId={spaceId} now={now} />}
          <Latest
            entries={overview.entries}
            events={overview.events}
            people={overview.people}
            readingNames={overview.readingNames}
            on={{ label: overview.name, spaceId }}
            diary={grow !== null}
            byline={!demo}
            plants={overview.plants}
            now={now}
          />
          {hasDevice ? (
            <Targets
              spaceId={spaceId}
              name={overview.name}
              targets={targets}
              device={device}
              humidifierHold={humidifierHold}
              offline={offline}
              mayManage={mayManage}
              guest={guest}
              now={now}
            />
          ) : null}
          {/* Offered only where it can do what it says: a device that is silent or has yet to speak would not hear it, and a plug parks nothing. */}
          {parks ? <MaintenanceControl devices={here} now={now} /> : null}
          {offerGrow ? <GrowOffer spaceId={spaceId} name={overview.name} diary={diary} /> : null}
          {offerDevice ? <DeviceOffer /> : null}
          {demo || visiting ? null : <AddPlace />}
        </div>
      </div>
    </section>
  );
}

/**
 * The newest picture taken in the light, as the head of the place: named by
 * what grows there, dated top right - or said to be the last lit one while the
 * lamp is off, and the last there is while nothing is heard. The readings in
 * its foot each lead to their curve; figures that have stopped coming step
 * back and say as of when they are.
 */
function CameraHead({
  camera,
  name,
  label,
  day,
  readings,
  curveOf,
  age,
  stand,
}: {
  camera: OverviewCamera;
  name: string;
  label: string;
  day: string | null;
  readings: Reading[];
  curveOf: (reading: Reading) => string;
  age: 'live' | 'stale' | 'offline';
  stand: string | null;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const called = useCameraCalled();
  const still = shownStill(camera);
  // Before the first picture of the day the strip is empty, and the camera's newest frame is yesterday's.
  const latest = useLatestStills(still === null && camera.lastStillAt ? [camera.cameraId] : []);
  const mediaId = still?.mediaId ?? latest.get(camera.cameraId) ?? null;
  const takenAt = still?.capturedAt ?? camera.lastStillAt;
  const time = takenAt ? sinceLabel(takenAt, now, zone) : null;
  const offline = age === 'offline';

  return (
    <Picture
      to={`/cameras/${camera.cameraId}`}
      src={mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null}
      alt={t('home.card.stillAlt', { name })}
      opens={t('start.picture.open', { name: called(camera.name) })}
      name={label}
      day={day}
      right={time ? t(offline ? 'camera.picture.last' : still?.dark ? 'camera.picture.lightOff' : 'start.picture.takenAt', { time }) : null}
      warns={offline}
      readings={readings}
      curveOf={curveOf}
      age={age}
      stand={stand}
      empty={t('start.camera.none')}
    />
  );
}

/**
 * What only some places measure, in one line: each reading the way to its own
 * curve, a finger high.
 */
function Extras({ spaceId, extras }: { spaceId: string; extras: Extra[] }) {
  return (
    <Facts
      className={styles.extras}
      facts={extras.map(extra => (
        <Link key={extra.key} to={timelinePath(spaceId, extra.focus)} className={styles.extra}>
          {unbroken(extra.text)}
        </Link>
      ))}
    />
  );
}

/** How long a camera may be silent before the sentence says it stopped, where no alarm has said so yet. */
const CAMERA_QUIET_MS = 30 * 60_000;

/**
 * The one sentence a place says about itself: all in target, or the one thing
 * that is not, leading to where it is looked into - the reading's curve, the
 * alarm, Steuerung for a place whose regulation is off or unset. A place a
 * camera alone watches says whether the camera delivers, because that is the
 * one thing there that can stop working; a diary kept by hand says nothing.
 * Silence is said by the box above the picture instead, and a device still
 * waiting for its first values by the pill.
 */
function StatusSentence({
  status,
  overview,
  camera,
  mayManage,
  device,
  parks,
}: {
  status: Status;
  overview: SpaceOverview;
  camera: OverviewCamera | null;
  mayManage: boolean;
  device: Device | null;
  /** Whether the page draws the control maintenance is ended at, which then says it alone. */
  parks: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const called = useCameraCalled();
  // Silence is the box's to say, that a device has yet to send its first value the pill's beside the name, and a
  // window of maintenance the control further down that runs it (with the pill's "Wartung") - unless other alerts of
  // the place stand open behind them, which the sentence then counts and says nothing else.
  // A late device is said once, by the pill's "veraltet" and its age.
  if (status.kind === 'stale') return null;
  const silent = status.kind === 'offline' || status.kind === 'waiting';
  const said = silent || (status.kind === 'maintenance' && status.quiet.parked && parks);
  if (said && status.more === 0) return null;
  const behind = openWords(t, status);
  let text: string;
  // A silent place's sentence is what stands open there, in the colour of the worst of it: the red of silence is the box's.
  let tone: ReturnType<typeof toneOf> = silent ? (status.critical ? 'alarm' : 'warn') : toneOf(status);
  let to: string | null;
  if (status.kind === 'none') {
    if (!camera) return null;
    const last = camera.lastStillAt;
    const quiet = last === null || now.toMillis() - DateTime.fromISO(last).toMillis() > CAMERA_QUIET_MS;
    text = quiet
      ? last
        ? t('start.camera.quietSince', { name: called(camera.name), time: sinceLabel(last, now, zone) })
        : t('start.camera.nothingYet', { name: called(camera.name) })
      : t('start.camera.delivers', { name: called(camera.name), age: ageLabel(last, now) });
    tone = quiet ? 'warn' : 'good';
    to = `/cameras/${camera.cameraId}`;
  } else {
    text =
      status.kind === 'good'
        ? t('start.allGood')
        : said
          ? ''
          : ((status.kind === 'noTargets' ? ownStatusOf(t, device, offsetOf(now, zone)) : null) ?? statusText(t, status, now, zone, false));
    to =
      status.kind === 'alert'
        ? status.alert.kind === 'camera_stale' && camera && status.more === 0
          ? `/cameras/${camera.cameraId}`
          : '/alerts'
        : 'more' in status && status.more > 0
          ? '/alerts'
          : status.kind === 'off'
            ? timelinePath(overview.spaceId, status.metric)
            : (status.kind === 'noTargets' || status.kind === 'controlOff' || status.kind === 'mode') && mayManage
              ? controlPath(overview.spaceId)
              : null;
  }

  // What stands open behind a status that is not an alert's own is said in words, in the alarm's colour where one of
  // it is critical; behind an alert's sentence "+2" goes in that sentence's colour.
  const critical = 'critical' in status && status.critical && status.kind !== 'alert';
  const words = (
    <Facts
      facts={[
        ...(text ? factsOf(text).map(unbroken) : []),
        behind ? (
          <span key="open" className={styles.open} data-tone={critical ? 'alarm' : undefined}>
            {unbroken(behind)}
          </span>
        ) : null,
      ]}
    />
  );
  // One live region whatever the status is, so a change from "Alles im Ziel" to a reading off its target is said.
  // A camera's sentence carries a ticking age and is left out of it.
  return (
    <div role={status.kind === 'none' ? undefined : 'status'} className={styles.statusFrame}>
      {to ? (
        <Link to={to} className={styles.status} data-tone={tone}>
          {words}
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </Link>
      ) : (
        <p className={styles.status} data-tone={tone}>
          {words}
        </p>
      )}
    </div>
  );
}

/**
 * The work mode where it is not the everyday one, under the status: a device
 * germinating is dark and holds one temperature, and "Alles im Ziel" over it
 * reads like a device holding its day. Named in two words, explained by its
 * help, and changed under Steuerung.
 */
function ModeLine({
  device,
  spaceId,
  mayManage,
  humidifierHold,
}: {
  device: Device | null;
  spaceId: string;
  mayManage: boolean;
  humidifierHold: HumidifierHold | null;
}) {
  const { t } = useTranslation();
  const control = device?.control;
  const mode = control?.running ? workModeOf(control) : null;
  const kind = mode === 'standard' ? null : mode;
  if (!kind) return null;

  return (
    <p className={styles.mode}>
      <span>
        {kind === 'germination' && humidifierHold
          ? t('start.mode.germinationHumidified', { humidity: targetWithUnit(humidifierHold.target, 'humidity') })
          : t(kind === 'germination' ? 'operatingMode.germination' : `start.mode.${kind}`)}
        <Help topic={kind === 'greenhouse' ? 'advanced.operatingMode' : kind} />
      </span>
      {mayManage ? (
        <Link to={controlPath(spaceId, kind === 'greenhouse' ? 'mode' : null)} className={styles.modeChange}>
          {t('start.change')} ›
        </Link>
      ) : null}
    </p>
  );
}
