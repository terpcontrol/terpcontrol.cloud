import { ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { Device, Entry, OverviewCamera, OverviewGrow, SpaceOverview } from '@fg2/shared-types/v1';
import { workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useAccountMe } from '@/api/account';
import { useLatestStills } from '@/api/cameras';
import { serverNow } from '@/api/clock';
import { useDeviceLive } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { noLongerThere } from '@/api/problem';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { controlPath, devicesPath, GROW, membersPath, timelinePath, usePageOfPlace } from '@/app/places';
import { ageLabel, dayStamp, sinceLabel } from '@/ui/age';
import { BackLink } from '@/ui/BackLink';
import { useCameraCalled } from '@/ui/camera-name';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { LivenessPill } from '@/ui/LivenessPill';
import { maintenanceQuiet, parksAnything, type Quiet } from '@/ui/maintenance';
import { OfflineSteps } from '@/ui/OfflineHelp';
import { NoLongerHere, RefreshFailed } from '@/ui/PageState';
import { usePlaceDevices } from '@/ui/place-devices';
import { useMayManage, useVisiting } from '@/ui/session-access';
import { targetWithUnit } from '@/ui/units';
import { useNow } from '@/ui/useNow';
import { offsetOf } from '@/ui/wall-clock';
import { useWideWindow } from '@/ui/wide-window';
import { clock, useZone } from '@/ui/zone';
import { ownStatusOf } from '@/screens/control/devices/own-summary';
import { MaintenanceControl } from '@/screens/devices/Maintenance';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { EmptyPlace } from '@/screens/space/EmptyPlace';
import { AddPlace } from './AddPlace';
import { livenessOf, measuredAtOf, silenceOf } from './attention';
import { DayCurves } from './DayCurves';
import { Latest } from './Latest';
import { DeviceOffer, GrowOffer } from './Offers';
import { GrowHead, PhaseLine } from './Phase';
import { Picture } from './Picture';
import { climateDeviceOf, controlOffOf, shownStill, statusOf, statusText, toneOf, type HumidifierHold, type Status } from './place';
import { PlaceMenu } from './PlaceMenu';
import { curvePath, darkOf, extrasOf, readingsOf, type Extra, type Reading } from './readings';
import { ReadingTiles } from './ReadingTiles';
import { usePlace, useHumidifierHold } from './reads';
import { DemoBanner, GuestLine, StartFailed, StartWaiting } from './states';
import { Targets } from './Targets';
import type { Due } from './due';
import { Today } from './Today';
import styles from './Start.module.css';

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
    return noLongerThere(read.error) ? (
      <NoLongerHere what="space" />
    ) : (
      <StartFailed retry={() => void read.refetch()} error={read.error} retrying={read.isFetching} />
    );
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

/** The newest photo somebody wrote into the diary, which a grow without a camera is shown by. */
const ownPhotoOf = (entries: Entry[], growId: string): Entry | null =>
  entries.find(entry => entry.growId === growId && entry.cameraId === null && entry.mediaIds.length > 0) ?? null;

function Place({ overview, back, failedAt }: { overview: SpaceOverview; back: boolean; failedAt: number | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const navigate = useNavigate();
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
  const live = useDeviceLive(device?.id ?? null).data;
  // The lamp is the climate device's own output, or else a light of its own standing in the same place.
  const lamp = here.find(one => one.type === 'light' && one.id !== device?.id) ?? null;
  const lampLive = useDeviceLive(lamp?.id ?? null).data;
  const lit =
    device && live?.outputs.light?.value != null
      ? { device, live }
      : lamp && lampLive?.outputs.light?.value != null
        ? { device: lamp, live: lampLive }
        : null;
  const mayManage = useMayManage(spaceId);
  const visiting = useVisiting(spaceId);
  const demo = user?.isDemo === true;
  const me = useAccountMe();
  const space = useSpaces().data?.items.find(one => one.id === spaceId);
  const guest = !demo && !visiting && space !== undefined && user !== null && space.ownerId !== user.id;
  // The grow waits for the account's answer rather than flashing up for somebody who keeps no diary; the demo is shown it whole.
  // Support reading a customer's place is shown the customer's grow where one stands there, whatever its own account keeps.
  const layer = useDiaryLayer() && (me.data !== undefined || demo);
  const diary = visiting ? overview.grows.length > 0 : layer;
  const grow = diary ? (overview.grows[0] ?? null) : null;
  const liveness = livenessOf({ values, deviceIds: overview.deviceIds }, now);
  // No value at all is a device still waiting for its first one - or, where it was heard long ago, one silent since then.
  const silence = silenceOf(values, here, now);
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const waiting = liveness === 'offline' && values.length === 0 && silentSince === null;
  const offline = liveness === 'offline' && !waiting;
  const humidifierHold = useHumidifierHold(device);
  const status = statusOf(
    {
      values,
      setpoints,
      deviceIds: overview.deviceIds,
      openAlerts: overview.openAlerts,
      verdict: climate?.verdict ?? overview.verdict,
      quiet: quietOf(here, now),
      controlOff: controlOffOf(here),
      humidifierHold,
      silentSince,
    },
    now,
  );
  const camera = newestCamera(overview);
  // A diary kept by hand, with nothing here that measures or watches: the grow is the page.
  const kept = !hasDevice && camera === null ? grow : null;
  const byHand = kept !== null;
  const readings = readingsOf(t, { values, setpoints, device, lit: offline ? null : lit, hold: humidifierHold, now, zone });
  const extras = offline ? [] : extrasOf(t, overview.values, darkOf(readings, overview.values));
  const measuredAt = measuredAtOf(values) ?? silentSince;
  const ownMedia = kept ? (ownPhotoOf(overview.entries, kept.growId)?.mediaIds[0] ?? kept.coverMediaId) : null;
  const parks = mayManage && !offline && !waiting && here.some(parksAnything);
  const growing = overview.grows.length > 0;
  // Offered once the account and the place have been read, to whoever may start a grow here and has not said no.
  const declined = diary ? space?.presetPrompt === 'never' : me.data?.preferences.diary === 'off';
  const offerGrow = !visiting && mayManage && hasDevice && !growing && me.data !== undefined && space !== undefined && !declined;
  const offerDevice = byHand && mayManage && me.data !== undefined && me.data.preferences.deviceOfferDeclined !== true;
  const due: Due[] = overview.dueTasks.map(task => ({
    task,
    spaceId,
    place: overview.name,
    grow: overview.grows.find(one => task.subject.type === 'grow' && one.growId === task.subject.id) ?? overview.grows[0] ?? null,
  }));
  const sentence = <StatusSentence status={status} overview={overview} camera={camera} mayManage={mayManage} device={device} parks={parks} />;
  const further = extras.length > 0 ? <Extras spaceId={spaceId} extras={extras} /> : null;
  // Somebody let in who may not manage the place has nothing behind the menu; who else is here is a tap on whose place it is.
  const menu = !demo && !visiting && mayManage;

  // Looking at a place here is what makes it the one Grow, Verlauf and Steuerung open on.
  usePageOfPlace(spaceId);

  return (
    <section className={styles.page} aria-labelledby={`${spaceId}-name`} data-single={byHand || undefined}>
      {demo ? <DemoBanner /> : null}
      <header className={styles.head}>
        {back ? <BackLink to="/" label={t('shell.tabs.home')} /> : null}
        {/* One name per place: the head is the place's, also where it holds nothing but a grow, and the menu renames what it shows. */}
        <h1 id={`${spaceId}-name`}>{overview.name}</h1>
        {wide && !offline ? sentence : null}
        <div className={styles.headEnd}>
          {hasDevice ? <LivenessPill liveness={liveness} measuredAt={measuredAt} now={now} explain waiting={waiting} /> : null}
          {menu ? (
            <span className={styles.menu}>
              <PlaceMenu overview={overview} />
            </span>
          ) : null}
        </div>
      </header>
      {guest && space ? <GuestLine space={space} people={overview.people} to={membersPath(spaceId)} /> : null}
      <RefreshFailed failedAt={failedAt} now={now} />
      {visiting ? <p className={styles.cardText}>{t('start.visiting')}</p> : null}
      {/* Devices moved together leave their old places empty; whether one goes is for its owner to say. */}
      {visiting ? null : <EmptyPlace spaceId={spaceId} onRemoved={() => void navigate('/')} />}
      {offline ? <OfflineBox overview={overview} since={measuredAt} /> : null}

      <div className={styles.columns}>
        <div className={styles.column}>
          {camera ? (
            <CameraHead
              camera={camera}
              name={overview.name}
              label={grow ? grow.name : called(camera.name)}
              day={grow?.dayNumber != null ? t('home.card.dayN', { day: grow.dayNumber }) : null}
              readings={readings}
              curveOf={reading => curvePath(spaceId, reading)}
              age={offline ? 'offline' : liveness === 'stale' ? 'stale' : 'live'}
              stand={
                liveness !== 'live' && measuredAt ? t('start.picture.stand', { time: clock(measuredAt, zone), age: ageLabel(measuredAt, now) }) : null
              }
            />
          ) : null}
          {kept && ownMedia ? <OwnPhoto grow={kept} mediaId={ownMedia} entries={overview.entries} userId={user?.id ?? null} /> : null}
          {grow && !camera && !(kept && ownMedia) ? <GrowHead grow={grow} to={GROW} /> : null}
          {/* What only some places measure stands directly under what carries the four readings: the picture, or the tiles. */}
          {camera ? further : null}
          {wide || offline ? null : sentence}
          <ModeLine device={device} spaceId={spaceId} mayManage={mayManage} humidifierHold={humidifierHold} />
          {camera || readings.length === 0 ? null : <ReadingTiles spaceId={spaceId} readings={readings} />}
          {camera ? null : further}
          {grow && (camera || (kept && ownMedia)) ? <PhaseLine grow={grow} to={GROW} /> : null}
          {wide && hasDevice && !byHand ? <DayCurves spaceId={spaceId} targets={targets} /> : null}
        </div>

        <div className={styles.column}>
          {/* It says itself whether anything here can call on the account - a device, a camera, a reminder. */}
          {visiting ? null : <NotifyNotice later />}
          {/* What is due is there to be settled, so a session that may write nothing is not shown the list.
              The diary's reminders come with the diary; a plan step waiting for its word is Steuerung's and comes without. */}
          {demo ? null : (
            <Today due={diary ? due : []} places={[{ spaceId, name: overview.name, growIds: overview.grows.map(one => one.growId) }]} now={now} />
          )}
          <Latest
            entries={overview.entries}
            people={overview.people}
            readingNames={overview.readingNames}
            on={{ label: overview.name, spaceId }}
            diary={grow !== null}
            byline={!demo}
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
          {parks ? <MaintenanceControl devices={here} now={now} id={MAINTENANCE} /> : null}
          {offerGrow ? <GrowOffer spaceId={spaceId} name={overview.name} diary={diary} /> : null}
          {offerDevice ? <DeviceOffer /> : null}
          {demo || visiting ? null : <AddPlace />}
        </div>
      </div>
    </section>
  );
}

/** Where maintenance is started and ended, which the sentence that says it is running leads to. */
const MAINTENANCE = 'start-maintenance';

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
      right={time ? t(offline ? 'start.picture.last' : still?.dark ? 'start.picture.lightOff' : 'start.picture.takenAt', { time }) : null}
      warns={offline}
      readings={readings}
      curveOf={curveOf}
      age={age}
      stand={stand}
      empty={t('start.camera.none')}
    />
  );
}

/** A grow without a camera is shown by the newest photo written into its diary, and failing that by its cover. */
function OwnPhoto({ grow, mediaId, entries, userId }: { grow: OverviewGrow; mediaId: string; entries: Entry[]; userId: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const photo = ownPhotoOf(entries, grow.growId);

  return (
    <Picture
      to={GROW}
      src={mediaUrl(mediaId, THUMBNAIL_WIDTH.frame)}
      alt={t('start.picture.photoAlt', { name: grow.name })}
      opens={t('start.picture.openGrow')}
      name={grow.name}
      day={grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null}
      right={
        photo ? t(photo.authorId === userId ? 'start.picture.yours' : 'start.picture.photo', { day: dayStamp(photo.occurredAt, now, zone) }) : null
      }
      empty=""
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
  /** Whether the page draws the control maintenance is ended at, which the sentence about it then leads to. */
  parks: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const called = useCameraCalled();
  let text: string;
  let tone: ReturnType<typeof toneOf> = toneOf(status);
  let to: string | null;

  // Silence is the box's to say, and that a device has yet to send its first value the pill's beside the name.
  if (status.kind === 'offline' || status.kind === 'waiting') return null;
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
        : ((status.kind === 'noTargets' ? ownStatusOf(t, device, offsetOf(now, zone)) : null) ?? statusText(t, status, now, zone));
    to =
      status.kind === 'alert'
        ? status.alert.kind === 'camera_stale' && camera
          ? `/cameras/${camera.cameraId}`
          : '/alerts'
        : status.kind === 'off'
          ? timelinePath(overview.spaceId, status.metric)
          : (status.kind === 'noTargets' || status.kind === 'controlOff') && mayManage
            ? controlPath(overview.spaceId)
            : null;
  }

  const said = <Facts facts={factsOf(text).map(unbroken)} />;
  // A window of maintenance is ended and extended where it was started, further down this page.
  const control = status.kind === 'maintenance' && status.quiet.parked && parks;
  const toControl = () => {
    const target = document.getElementById(MAINTENANCE);
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  };

  // One live region whatever the status is, so a change from "Alles im Ziel" to a reading off its target is said.
  // A camera's sentence carries a ticking age and is left out of it.
  return (
    <div role={status.kind === 'none' ? undefined : 'status'} className={styles.statusFrame}>
      {control ? (
        <a
          href={`#${MAINTENANCE}`}
          className={styles.status}
          data-tone={tone}
          onClick={event => {
            event.preventDefault();
            toControl();
          }}
        >
          {said}
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </a>
      ) : to ? (
        <Link to={to} className={styles.status} data-tone={tone}>
          {said}
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </Link>
      ) : (
        <p className={styles.status} data-tone={tone}>
          {said}
        </p>
      )}
    </div>
  );
}

/**
 * The work mode where it is not the everyday one, under the status: a device
 * germinating is dark and holds one temperature, and "Alles im Ziel" over it
 * reads like a device holding its day. Named in two words, explained by its
 * help, and changed under Steuerung - the greenhouse mode in the device's
 * panel.
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
          : t(`start.mode.${kind}`)}
        <Help topic={kind === 'greenhouse' ? 'advanced.operatingMode' : kind} />
      </span>
      {mayManage ? (
        <Link to={kind === 'greenhouse' ? devicesPath(spaceId) : controlPath(spaceId)} className={styles.modeChange}>
          {t('start.change')} ›
        </Link>
      ) : null}
    </p>
  );
}

/**
 * A place gone quiet: since when, that the device goes on regulating, and
 * that what is drawn below is the last there is. What to try is a tap away
 * and opens where it stands - nothing here can ask a silent device for
 * anything, so the steps are the grower's own.
 */
function OfflineBox({ overview, since }: { overview: SpaceOverview; since: string | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.box} role="status">
      <h2>{t('start.offline.title', { time: since ? sinceLabel(since, now, zone) : '' })}</h2>
      <p>{t('start.offline.text')}</p>
      <button type="button" className={styles.boxLink} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('start.offline.help')} ›
      </button>
      {open ? <OfflineSteps devicesLink={overview.deviceIds === null ? null : devicesPath(overview.spaceId)} /> : null}
    </section>
  );
}
