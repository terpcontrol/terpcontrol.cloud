import { ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, Metric, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { useAccountMe } from '@/api/account';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { serverNow } from '@/api/clock';
import { useHourMeans } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { noLongerThere } from '@/api/problem';
import { useHomeShape } from '@/api/home';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { controlPath, devicePath, editPath, GROW, membersPath, timelinePath, usePageOfPlace } from '@/app/places';
import { usePlaceGrow } from '@/log/underneath';
import { ageLabel, deviceLiveness, sinceLabel } from '@/ui/age';
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
import { useZone } from '@/ui/zone';
import { pendingByPath, savedWords } from '@/screens/control/climate/figures';
import { leadOf, leadValuesOf } from '@/screens/control/lead';
import { ownStatusOf } from '@/screens/control/devices/own-summary';
import { heldWords } from '@/screens/control/held-light';
import { offNotTaken, onNotTaken } from '@/screens/control/rows';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { MaintenanceControl } from '@/screens/devices/Maintenance';
import { NotifyNotice } from '@/screens/notifications/NotifyNotice';
import { EmptyPlace } from '@/screens/space/EmptyPlace';
import { AddPlace } from './AddPlace';
import { Alarms } from './Alarms';
import { comingOf, judgedAt, judgedBy, livenessThrough, measuredAtOf } from './attention';
import { Latest } from './Latest';
import { DeviceOffer, GrowOffer } from './Offers';
import { growPutOff } from './loaded';
import { Picture } from './Picture';
import { GrowRow } from './Rows';
import { contradictedModeOf, controlOffOf, openWords, statusOf, statusText, toneOf, valueOf, type HumidifierHold, type Status } from './place';
import { Menu, MenuLink } from '@/ui/Menu';
import { readingsOf } from './readings';
import { useLastDay, usePlace, useHumidifierHold, useLamp, usePlaceAlerts } from './reads';
import { DemoBanner, GuestLine, StartFailed, StartWaiting } from './states';
import { Targets } from './Targets';
import { Tiles } from './Tiles';
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

/** What only some places measure: CO₂, the leaf and the light that reaches it. */
const SOME: Metric[] = ['co2', 'leafTemperature', 'lux', 'ppfd'];

/** The camera here that delivered last, which is the one the place is shown by. */
const newestCamera = (overview: SpaceOverview): OverviewCamera | null =>
  [...overview.cameras].sort((one, other) => (other.lastStillAt ?? '').localeCompare(one.lastStillAt ?? ''))[0] ?? null;

function Place({ overview, back, failedAt }: { overview: SpaceOverview; back: boolean; failedAt: number | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const spaceId = overview.spaceId;
  const hasDevice = overview.deviceIds === null || overview.deviceIds.length > 0;
  const placeDevices = usePlaceDevices(spaceId, overview.deviceIds ?? [], hasDevice);
  const here = placeDevices.items;
  // A place is one climate: its lead device's - the controller, heard or not - whose figures alone are the place's.
  const device = leadOf(here, overview.climates);
  const lamp = useLamp(device, here, now);
  const { climate, values, placeWide } = leadValuesOf(device, overview.climates, overview.values, lamp.live);
  const setpoints = climate?.setpoints ?? (placeWide ? overview.setpoints : []);
  const targets = climate?.targets ?? (placeWide ? overview.targets : null);
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
  // A second grow started where one already runs: both are shown, the one the place leads with first - the
  // one Eintrag over it aims at - and the other as a row of its own.
  const lead = usePlaceGrow(spaceId);
  const grow = diary ? (overview.grows.find(one => one.growId === lead) ?? overview.grows[0] ?? null) : null;
  const also = diary ? overview.grows.filter(one => one !== grow) : [];
  // A refresh that fails ages the page, not the device: the place is judged as the last answer left it.
  const judged = judgedAt(now, failedAt);
  // The place lives and falls silent with the device that holds its climate, whatever else of it still reports.
  const judging = judgedBy(values, here, device, judged);
  // A lead heard whose first values have yet to reach the read - one just claimed - is as alive as it was heard.
  const coming = comingOf(judging, device, judged);
  const liveness = coming
    ? deviceLiveness(coming, judged)
    : livenessThrough({ values: judging.values, deviceIds: overview.deviceIds }, now, failedAt);
  // No value at all is a device still waiting for its first one - or, where it was heard long ago, one silent since then.
  const silence = judging.silence;
  const silentSince = silence && !silence.waiting ? silence.since : null;
  const waiting = liveness === 'offline' && judging.values.length === 0 && silentSince === null;
  const offline = liveness === 'offline' && !waiting;
  // Either way the lead has no figures yet, and the place none of anything else's.
  const unread = waiting || coming !== null;
  const humidifierHold = useHumidifierHold(device);
  const openAlerts = usePlaceAlerts(overview.openAlerts, here, judged);
  const controlOff = controlOffOf(here);
  // A switch-off the device was not heard to take is a setting it has not been handed: said as Steuerung says it.
  const offStored = device ? offNotTaken(device, pendingByPath(lamp.live?.pending)) : null;
  // And a switch-on stored the same way: the device still holds no targets, as it last reported.
  const onStored = device ? onNotTaken(device, pendingByPath(lamp.live?.pending)) : null;
  const quiet = quietOf(here, now);
  const status = statusOf(
    {
      values: judging.values,
      setpoints,
      deviceIds: overview.deviceIds,
      openAlerts,
      leadId: device?.id,
      verdict: climate?.verdict ?? (placeWide ? overview.verdict : null),
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
  // "Alles im Ziel" over a lamp somebody holds off would read as a tent keeping its day.
  const heldLamp = offline ? null : (lamp.lit.find(one => one.held) ?? null);
  // What only some places measure is the place's, whichever of its devices measures it; a lead with no figures yet
  // leaves the place without any: a socket's CO₂ is no reading of the place's.
  const measured = unread
    ? values
    : [...values.filter(value => !SOME.includes(value.metric)), ...overview.values.filter(value => SOME.includes(value.metric))];
  const readings = readingsOf(t, { values: measured, setpoints, device, lit: lamp.lit, hold: humidifierHold, now, zone });
  const measuredAt = measuredAtOf(judging.values) ?? silentSince ?? coming;
  // The day's curves are the lead's - CO₂, the leaf and the light whichever device here measures them, as the server
  // reads them: a place waiting for its figures has none, whatever else of it reported.
  const curves = readings.some(reading => reading.key !== 'light' && reading.key !== 'vpd') || valueOf(measured, 'leafTemperature') !== null;
  const curvesWanted = hasDevice && !byHand && !unread && curves;
  const { day, pending: dayPending } = useLastDay(spaceId, device?.id ?? null, curvesWanted);
  // The last hour and the alarms are asked for with the page's own reads, not by the parts that show them once it is
  // drawn: read a round trip later, they landed under the reader - and one that failed left the page half built through
  // its retries.
  const meansWanted = !offline && readings.some(reading => reading.key !== 'light' && reading.key !== 'vpd');
  const means = useHourMeans(device?.id ?? null, meansWanted);
  const rules = useAlarmRulesOf(hasDevice ? here.map(one => one.id) : []);
  const parks = mayManage && !offline && !waiting && here.some(parksAnything);
  const growing = overview.grows.length > 0;
  // Offered once the account and the place have been read, to whoever may start a grow here and has not said no - in a
  // place kept by hand too, where the diary is kept: a grow that ended there left its lines and nothing leading on.
  const declined = diary ? space?.presetPrompt === 'never' : me.data?.preferences.diary === 'off';
  const offerGrow =
    !visiting &&
    mayManage &&
    (hasDevice || diary) &&
    !growing &&
    me.data !== undefined &&
    space !== undefined &&
    !declined &&
    !growPutOff(spaceId, now);
  const offerDevice = byHand && mayManage && me.data !== undefined && me.data.preferences.deviceOfferDeclined !== true;
  const sentence = <StatusSentence status={status} overview={overview} camera={camera} mayManage={mayManage} device={device} parks={parks} />;
  // Somebody let in who may not manage the place has nothing behind the menu; who else is here is a tap on whose place it is.
  const menu = !demo && !visiting && mayManage;

  // Looking at a place here is what makes it the one Grow, Verlauf and Steuerung open on.
  usePageOfPlace(spaceId);

  // The tiles are decided by three answers - the place, its devices and each lamp's own report -, and the page is drawn
  // once they, the day, the hour's means and the alarms are in: a tile set that grew as they landed turned a row of
  // three into two rows of two under the reader, and an output's "läuft seit 2 Std" from the day broke its foot onto a
  // second line. A read that fails lets the page draw, its part's room kept.
  // Once drawn the page stays: a device added later brings its reads into the room kept for them, not the waiting shape.
  // Nor does a page that cannot reach the server wait for them: it shows what it last knew.
  const settling =
    hasDevice && failedAt === null && (placeDevices.isPending || lamp.pending || rules.isPending || (meansWanted && means.isPending) || dayPending);
  const [drawn, setDrawn] = useState(false);
  if (!settling && !drawn) setDrawn(true);
  if (settling && !drawn) return <StartWaiting />;

  return (
    <section className={`${ui.stack3} ${styles.page}`} aria-labelledby={`${spaceId}-name`} data-single={byHand || undefined}>
      {demo ? <DemoBanner /> : null}
      <header className={styles.head}>
        {back ? <BackLink to="/" label={t('shell.tabs.home')} /> : null}
        {/* One name per place: the head is the place's, also where it holds nothing but a grow, and the menu renames what it shows. */}
        <h1 id={`${spaceId}-name`}>{overview.name}</h1>
        {sentence}
        <div className={styles.headEnd}>
          {hasDevice ? (
            <LivenessPill
              liveness={liveness}
              measuredAt={measuredAt}
              now={now}
              explain
              waiting={waiting}
              awaited={waiting && device && here.length > 1 ? deviceName(device, t) : null}
              coming={coming !== null}
            />
          ) : null}
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
            : onStored
              ? t('control.pending.on', { saved: savedWords(t, onStored.savedAt, now, zone) })
              : t(
                  controlOff
                    ? 'start.offline.textOff'
                    : device && !OWN_CLIMATE_TYPES.includes(device.type)
                      ? 'start.offline.textOwn'
                      : 'start.offline.text',
                )}
        </OfflineBox>
      ) : null}

      <div className={`${ui.stack3} ${styles.columns}`}>
        <div className={`${ui.stack3} ${styles.column}`}>
          {/* A work mode the status already says is not said again under it. */}
          {status.kind === 'mode' ? null : <ModeLine device={device} spaceId={spaceId} mayManage={mayManage} humidifierHold={humidifierHold} />}
          {heldLamp?.held ? (
            <p className={styles.mode}>
              <span>
                {readings.find(reading => reading.deviceId === heldLamp.device.id)?.label} {heldWords(t, heldLamp.held, now, zone)}
              </span>
              {mayManage ? (
                <Link
                  to={controlPath(spaceId, 'outputs', heldLamp.device.id === device?.id ? {} : { device: heldLamp.device.id })}
                  className={styles.modeChange}
                >
                  {t('start.change')} ›
                </Link>
              ) : null}
            </p>
          ) : null}
          <Tiles
            spaceId={spaceId}
            readings={readings}
            values={measured}
            setpoints={setpoints}
            targets={targets}
            device={device}
            live={lamp.live}
            lamps={lamp.lit}
            day={day}
            dayComing={dayPending}
            means={means.data}
            meansWanted={meansWanted}
            hold={humidifierHold}
            now={now}
            offline={offline}
          />
          {/* The place as it looks: the camera's picture with the grow under it, or the grow as a row of its own. */}
          {camera ? (
            <Picture camera={camera} grow={grow} entries={overview.entries} name={overview.name} offline={offline} />
          ) : grow ? (
            <div className={ui.group}>
              <GrowRow grow={grow} to={GROW} entries={kept ? overview.entries : null} />
            </div>
          ) : null}
          {also.length > 0 ? (
            <div className={ui.group}>
              {also.map(one => (
                <GrowRow key={one.growId} grow={one} to={`/grows/${one.growId}`} />
              ))}
            </div>
          ) : null}
          {/* Where the grow will stand once one is started: under the tiles, not at the foot of the other column. */}
          {offerGrow ? <GrowOffer spaceId={spaceId} name={overview.name} diary={diary} byHand={!hasDevice} /> : null}
        </div>

        <div className={`${ui.stack3} ${styles.column}`}>
          {hasDevice ? (
            <Targets
              spaceId={spaceId}
              name={overview.name}
              targets={targets}
              device={device}
              live={lamp.live}
              humidifierHold={humidifierHold}
              offline={offline}
              offStored={offStored !== null}
              mayManage={mayManage}
              guest={guest}
              now={now}
            />
          ) : null}
          {hasDevice ? <Alarms spaceId={spaceId} devices={here} rules={rules} mayManage={mayManage} /> : null}
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
            grows={diary ? overview.grows : []}
            devices={overview.devices}
            now={now}
            offStored={offStored?.savedAt ?? null}
          />
          {/* Offered only where it can do what it says: a device that is silent or has yet to speak would not hear it, and a plug parks nothing. */}
          {parks ? <MaintenanceControl devices={here} now={now} /> : null}
          {offerDevice ? <DeviceOffer /> : null}
          {demo || visiting ? null : <AddPlace />}
        </div>
      </div>
    </section>
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
 * Silence is said by the box over the figures instead, and a device still
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
  let tone: ReturnType<typeof toneOf> = silent ? (status.critical > 0 ? 'alarm' : 'warn') : toneOf(status);
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
  const critical = 'critical' in status && status.critical > 0 && status.kind !== 'alert';
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
