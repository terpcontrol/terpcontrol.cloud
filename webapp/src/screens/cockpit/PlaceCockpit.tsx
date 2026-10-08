import { ChevronRight, CircleCheck, Clock, Info, Power, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath, devicesPath, timelinePath, useRememberPlace } from '@/app/places';
import type { Device, OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { workModeOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { serverNow } from '@/api/clock';
import { useDeviceLive } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { noLongerThere } from '@/api/problem';
import { useSession } from '@/api/session';
import { useTimeline } from '@/api/timeline';
import { useCorrecting } from '@/log/corrections';
import { ageLabel, sinceLabel } from '@/ui/age';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import { useCameraCalled } from '@/ui/camera-name';
import { EntryRow } from '@/ui/EntryRow';
import { Help } from '@/ui/Help';
import { foldRepeats, readingNamesOf } from '@/ui/entries';
import { maintenanceQuiet, parksAnything, type Quiet } from '@/ui/maintenance';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { usePlaceDevices } from '@/ui/place-devices';
import { useAccountMe, useMayManage, useVisiting } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { BackLink } from '@/ui/BackLink';
import { ownStatusOf } from '../control/devices/own-summary';
import { offsetOf } from '../control/targets/targets-draft';
import { ControlButton } from '../devices/ControlSwitch';
import { MaintenanceButton } from '../devices/Maintenance';
import { livenessOf, measuredAtOf } from '../home/attention';
import { DeviceOffer } from '../home/DeviceOffer';
import { DiaryOffer } from '../home/DiaryOffer';
import { LivenessPill } from '../home/LivenessPill';
import { OfflineHelp } from '../home/OfflineHelp';
import { targetFigure, UNIT } from '../home/units';
import { NotifyNotice } from '../notifications/NotifyNotice';
import { CameraPicture } from './CameraPicture';
import { GrowBlock } from './GrowBlock';
import {
  climateDeviceOf,
  controlOffOf,
  focusLink,
  KIND_ICON,
  shownStill,
  statusOf,
  statusText,
  toneOf,
  type HumidifierHold,
  type Status,
} from './place';
import { PlaceMenu } from './PlaceMenu';
import { usePlace, useHumidifierHold } from './reads';
import { AlarmsSummary, TargetsSummary } from './Summaries';
import { Tiles } from './Tiles';
import styles from './Cockpit.module.css';

/**
 * One place, read for the questions it is opened with, in their order: is
 * everything all right, and would I be told if it were not; what does it read
 * and what is running; what is it set to and what watches over it; what grows
 * here; what happened last.
 *
 * It is the only place page there is, for one place or many: Start draws it
 * for an account with one place, and every place of an account with several
 * opens it at its own address. Nothing here depends on how many places there
 * are, so a second device or a link from an alert lands on the same page.
 *
 * `headed` draws the place's name, its pill and its menu above it, for where
 * the page around it does not already, and `back` the way to Start before the
 * name, where Start is a card per place rather than this page.
 */
export function PlaceCockpit({
  overview,
  headed = false,
  back = false,
  failedAt = null,
}: {
  overview: SpaceOverview;
  headed?: boolean;
  back?: boolean;
  failedAt?: number | null;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const spaceId = overview.spaceId;
  const hasDevice = overview.deviceIds === null || overview.deviceIds.length > 0;
  const here = usePlaceDevices(spaceId, overview.deviceIds ?? [], hasDevice).items;
  const device = climateDeviceOf(here, overview.deviceIds);
  const live = useDeviceLive(device?.id ?? null).data;
  const timeline = useTimeline(hasDevice ? spaceId : '', '24h', null).data;
  const mayManage = useMayManage(spaceId);
  const visiting = useVisiting(spaceId);
  const me = useAccountMe();
  // The grow waits for the account's answer rather than flashing up for somebody who keeps no diary; the demo is shown it whole.
  // Support reading a customer's place is shown the customer's grow where one stands there, whatever its own account keeps.
  const layer = useDiaryLayer() && (me.data !== undefined || user?.isDemo === true);
  const diary = visiting ? overview.grows.length > 0 : layer;
  const liveness = livenessOf(overview, now);
  const offline = liveness === 'offline';
  // A humidifier holding the humidity while the device germinates is a target the server names none for.
  const humidifierHold = useHumidifierHold(device);
  const status = statusOf({ ...overview, quiet: quietOf(here, now), controlOff: controlOffOf(here), humidifierHold }, now);
  // Offered once the account has been read, and only where nobody said no; the demo has no account to keep an answer with.
  const offerDiary = !visiting && me.data !== undefined && !me.data.layers.diary && me.data.preferences.diary !== 'off';
  const Icon = KIND_ICON[overview.kind];
  const camera = newestCamera(overview);
  // A diary kept by hand, with nothing here that measures or watches: the grow
  // is the page, in one column, and hardware is a quiet offer under it rather
  // than the first line over it.
  const byHand = !hasDevice && camera === null && diary;
  const offerDevice = byHand && mayManage && me.data !== undefined && me.data.preferences.deviceOfferDeclined !== true;
  // The grow block carries the camera's picture where both are here, right
  // under the readings: one picture of the tent rather than the same one three
  // times, and the grow a thumb away rather than under the summaries.
  const growUp = diary && camera !== null;
  const shown = growUp || camera === null ? null : shownStill(camera);
  const pictured = camera ? shownStill(camera) : null;

  // Verlauf and Steuerung land on the place last looked at, and looking at one here is what makes it that place.
  useRememberPlace(spaceId);

  return (
    <section
      className={styles.cockpit}
      data-single={byHand || undefined}
      aria-label={headed ? undefined : overview.name}
      aria-labelledby={headed ? `${spaceId}-name` : undefined}
    >
      {headed ? (
        <header className={styles.head} data-back={back || undefined}>
          {back ? <BackLink to="/" label={t('shell.tabs.home')} /> : null}
          <h1 className={styles.name} id={`${spaceId}-name`}>
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span>{overview.name}</span>
          </h1>
          {/* The pill and the ⋯ go together: where the name leaves them no room, both move to the row under it. */}
          <div className={styles.headEnd}>
            {hasDevice ? <LivenessPill liveness={liveness} measuredAt={measuredAtOf(overview.values)} now={now} explain /> : null}
            <PlaceMenu overview={overview} />
          </div>
        </header>
      ) : null}
      {headed ? <RefreshFailed failedAt={failedAt} now={now} /> : null}
      {visiting ? (
        <p className={styles.status} data-tone="quiet" role="status">
          <Info size={18} strokeWidth={2} aria-hidden />
          <span className={styles.statusText}>{t('cockpit.visiting')}</span>
        </p>
      ) : null}

      {byHand ? (
        <div className={styles.columns} data-single>
          <div className={styles.column}>
            <NotifyNotice later />
            <GrowBlock overview={overview} still={null} now={now} mine={!visiting} />
            <Latest overview={overview} now={now} count={LATEST_BY_HAND} />
            {offerDevice ? <DeviceOffer /> : null}
          </div>
        </div>
      ) : (
        <div className={styles.columns}>
          <div className={styles.column}>
            <StatusLine
              status={status}
              overview={overview}
              camera={camera}
              diary={diary}
              now={now}
              zone={zone}
              mayManage={mayManage}
              ownLine={ownStatusOf(t, device, offsetOf(now, zone))}
            />
            <ModeLine device={device} spaceId={spaceId} mayManage={mayManage} humidifierHold={humidifierHold} />
            {/* Switched off, the way back on stands under the sentence that says so rather than under the tiles. */}
            {mayManage && device?.control && !device.control.running ? (
              <div className={styles.actions}>
                <span className={styles.withHelp}>
                  <ControlButton device={device} offline={offline} />
                  <Help topic="climateControl" />
                </span>
              </div>
            ) : null}
            {visiting ? null : <NotifyNotice later />}
            {hasDevice ? (
              <Tiles
                spaceId={spaceId}
                values={overview.values}
                setpoints={overview.setpoints}
                targets={overview.targets}
                device={device}
                live={live}
                timeline={timeline}
                now={now}
                offline={offline}
              />
            ) : null}
            {growUp && camera ? <GrowBlock overview={overview} camera={camera} still={pictured?.mediaId ?? null} now={now} mine={!visiting} /> : null}
            {camera && !growUp ? <CameraPicture overview={overview} camera={camera} now={now} /> : null}
            {/* Offered only where it can do what it says: an offline device would not hear it, and a plug parks nothing.
                The control switch stays offered offline, because the device is handed it when it is back. */}
            {mayManage && ((!offline && here.some(parksAnything)) || device?.control?.running) ? (
              <div className={styles.actions}>
                {!offline && here.some(parksAnything) ? <MaintenanceButton devices={here} now={now} className={ui.quiet} /> : null}
                {device?.control?.running ? (
                  <span className={styles.withHelp}>
                    <ControlButton device={device} offline={offline} className={ui.quiet} />
                    <Help topic="climateControl" />
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={styles.column}>
            {hasDevice ? (
              <TargetsSummary
                spaceId={spaceId}
                targets={overview.targets}
                device={device}
                live={live}
                now={now}
                offline={offline}
                mayChange={mayManage}
                humidifierHold={humidifierHold}
              />
            ) : null}
            {/* Whether alarms reach somebody is said of the reader's own account, which for support is not the customer's. */}
            {hasDevice && here.length > 0 ? (
              <AlarmsSummary spaceId={spaceId} devices={here} me={visiting ? undefined : me.data} mayChange={mayManage} />
            ) : null}
            {diary && !growUp ? <GrowBlock overview={overview} still={shown?.mediaId ?? null} now={now} mine={!visiting} /> : null}
            <Latest overview={overview} now={now} pictured={growUp ? (pictured?.mediaId ?? null) : null} />
            {offerDiary ? <DiaryOffer /> : null}
            <AdvancedSection scope="place" context={{ spaceId, devices: here, mayManage }} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The cockpit of one place on its own, for Start: it reads the place itself,
 * waits in its own shape, and says so plainly where the place has gone.
 */
export function PlaceCockpitRead({ spaceId, back = false }: { spaceId: string; back?: boolean }) {
  const { read, current, failedAt } = usePlace(spaceId);

  if (read.isPending) {
    return (
      <section className={styles.cockpit} aria-busy="true">
        <Waiting lines={2} />
        <Waiting lines={4} />
      </section>
    );
  }
  if (!current) return noLongerThere(read.error) ? <NoLongerHere what="space" /> : <LoadFailed retry={() => void read.refetch()} />;

  return <PlaceCockpit overview={current} headed back={back} failedAt={failedAt} />;
}

/** The window standing on any device here: the one still parking hardware first, then one whose alarms are still held. */
const quietOf = (devices: Device[], now: DateTime): Quiet | null => {
  const quiets = devices.map(device => maintenanceQuiet(device, DateTime.max(now, serverNow()))).filter((quiet): quiet is Quiet => quiet !== null);
  return quiets.find(quiet => quiet.parked) ?? quiets[0] ?? null;
};

const STATUS_ICON: Record<Status['kind'], LucideIcon> = {
  good: CircleCheck,
  off: TriangleAlert,
  alert: TriangleAlert,
  maintenance: Wrench,
  controlOff: Power,
  stale: Clock,
  noTargets: Info,
  waiting: Clock,
  offline: TriangleAlert,
  none: Info,
};

/**
 * The one sentence the page opens with. Gone quiet, it is the box that says
 * since when and what to try instead - in the moment somebody reads every word,
 * the steps are open from the start.
 *
 * A place with no sensor has no reading to judge. Where a camera watches it,
 * the sentence is about the camera - whether it is delivering, and since when
 * not - because that is the one thing here that can stop working. Where nothing
 * does and a diary is kept, there is no sentence at all: the grow is the page,
 * and hardware is offered under it rather than missed over it.
 */
function StatusLine({
  status,
  overview,
  camera,
  diary,
  now,
  zone,
  mayManage,
  ownLine = null,
}: {
  status: Status;
  overview: SpaceOverview;
  camera: OverviewCamera | null;
  diary: boolean;
  now: DateTime;
  zone: string | null;
  mayManage: boolean;
  /** What a smart socket or a lamp standing here is set to, which is what it has instead of targets. */
  ownLine?: string | null;
}) {
  const { t } = useTranslation();

  if (status.kind === 'offline') {
    return (
      <OfflineHelp since={measuredAtOf(overview.values)} now={now} devicesLink={overview.deviceIds === null ? null : devicesPath(overview.spaceId)} />
    );
  }
  if (status.kind === 'none' && camera) return <CameraLine camera={camera} now={now} zone={zone} />;
  if (status.kind === 'none') {
    if (diary) return null;
    return (
      <p className={styles.status} data-tone="quiet">
        <Info size={18} strokeWidth={2} aria-hidden />
        <span>{t('home.invite.noSensor')}</span>
        <Link to="/devices" className={ui.headLink}>
          {t('home.invite.addDevice')} ›
        </Link>
      </p>
    );
  }

  const Icon = STATUS_ICON[status.kind];
  const text = status.kind === 'noTargets' && ownLine ? ownLine : statusText(t, status, now, zone);
  const to =
    status.kind === 'alert'
      ? status.alert.kind === 'camera_stale' && camera
        ? `/cameras/${camera.cameraId}`
        : '/alerts'
      : status.kind === 'off'
        ? focusLink(overview.spaceId, status.metric)
        : status.kind === 'noTargets' && mayManage
          ? controlPath(overview.spaceId)
          : null;
  const body = (
    <>
      <Icon size={18} strokeWidth={2} aria-hidden />
      <span className={styles.statusText}>{text}</span>
      {to ? <ChevronRight size={16} strokeWidth={2} aria-hidden /> : null}
    </>
  );

  return to ? (
    <div role="status">
      <Link to={to} className={styles.status} data-tone={toneOf(status)}>
        {body}
      </Link>
    </div>
  ) : (
    <p className={styles.status} data-tone={toneOf(status)} role="status">
      {body}
    </p>
  );
}

/**
 * The work mode where it is not the everyday one, under the status line: a
 * device germinating is dark and holds one temperature, and the tiles under
 * "Alles im Ziel" read like a device holding its day. Drying and germination
 * are changed in Steuerung, where the next stage's climate ends them; the
 * greenhouse mode, in the device's panel.
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
  /** The humidity a humidifier holds in germination, which the line names beside the one temperature. */
  humidifierHold: HumidifierHold | null;
}) {
  const { t } = useTranslation();
  const control = device?.control;
  const mode = control?.running ? workModeOf(control) : null;
  const kind = mode === 'standard' ? null : mode;
  if (!kind) return null;

  return (
    <p className={styles.status} data-tone="quiet" role="status">
      <Info size={18} strokeWidth={2} aria-hidden />
      <span className={styles.statusText}>
        {kind === 'germination' && humidifierHold
          ? t('cockpit.mode.germinationHumidified', { humidity: `${targetFigure(humidifierHold.target, 'humidity')} ${UNIT.humidity}` })
          : t(`cockpit.mode.${kind}`)}
        <Help topic={kind === 'greenhouse' ? 'advanced.operatingMode' : kind} />
      </span>
      {mayManage ? (
        <Link to={kind === 'greenhouse' ? devicesPath(spaceId) : controlPath(spaceId)} className={ui.headLink}>
          {t('cockpit.mode.change')} ›
        </Link>
      ) : null}
    </p>
  );
}

/** How long a camera may be silent before the line says it stopped, where no alarm has said so yet. */
const CAMERA_QUIET_MS = 30 * 60_000;

/** "Terp Cam liefert · Bild vor 16 s", or since when it has not: the status of a place a camera alone watches. */
function CameraLine({ camera, now, zone }: { camera: OverviewCamera; now: DateTime; zone: string | null }) {
  const { t } = useTranslation();
  const called = useCameraCalled();
  const last = camera.lastStillAt;
  const quiet = last === null || now.toMillis() - DateTime.fromISO(last).toMillis() > CAMERA_QUIET_MS;
  const text = quiet
    ? last
      ? t('cockpit.camera.quietSince', { name: called(camera.name), time: sinceLabel(last, now, zone) })
      : t('cockpit.camera.nothingYet', { name: called(camera.name) })
    : t('cockpit.camera.delivers', { name: called(camera.name), age: ageLabel(last, now) });
  const Icon = quiet ? TriangleAlert : CircleCheck;

  return (
    <div role="status">
      <Link to={`/cameras/${camera.cameraId}`} className={styles.status} data-tone={quiet ? 'warn' : 'good'}>
        <Icon size={18} strokeWidth={2} aria-hidden />
        <span className={styles.statusText}>{text}</span>
        <ChevronRight size={16} strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}

/** The camera here that delivered last, which is the one the place is shown by. */
const newestCamera = (overview: SpaceOverview): OverviewCamera | null =>
  [...overview.cameras].sort((one, other) => (other.lastStillAt ?? '').localeCompare(one.lastStillAt ?? ''))[0] ?? null;

/** How many of the newest lines the cockpit names; the Timeline has the rest. */
const LATEST = 3;

/** A diary kept by hand is what its place page is made of, so more of it is shown. */
const LATEST_BY_HAND = 6;

/**
 * The newest things that happened here, each in one plain line. A photo line
 * whose picture already heads the page is named without it.
 */
function Latest({
  overview,
  now,
  count = LATEST,
  pictured = null,
}: {
  overview: SpaceOverview;
  now: DateTime;
  count?: number;
  pictured?: string | null;
}) {
  const { t } = useTranslation();
  const correcting = useCorrecting();
  const folded = foldRepeats(overview.entries).slice(0, count);

  return (
    <section className={styles.latest} aria-label={t('cockpit.latest.title')}>
      <header className={styles.latestHead}>
        <span className="label">{t('cockpit.latest.title')}</span>
        <Link to={timelinePath(overview.spaceId)} className={`mono ${ui.headLink}`}>
          {t('cockpit.latest.more')}
          <ChevronRight size={12} strokeWidth={2} aria-hidden />
        </Link>
      </header>
      {folded.length === 0 ? (
        <p className={ui.note}>{t('cockpit.latest.none')}</p>
      ) : (
        <ul className={`${ui.card} ${styles.entries}`}>
          {folded.map(({ entry, count: repeats, since }) => (
            <EntryRow
              key={entry.id}
              entry={pictured && entry.mediaIds.includes(pictured) ? { ...entry, mediaIds: entry.mediaIds.filter(id => id !== pictured) } : entry}
              repeats={{ count: repeats, since }}
              people={overview.people}
              measurements={readingNamesOf(overview.readingNames, entry.growId)}
              now={now}
              brief
              onOpen={correcting(entry, { label: overview.name, spaceId: overview.spaceId })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
