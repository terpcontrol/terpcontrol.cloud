import { Camera, ChevronLeft, ChevronRight, CircleCheck, Clock, Info, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { controlPath, devicesPath, timelinePath, useRememberPlace } from '@/app/places';
import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useLatestStills } from '@/api/cameras';
import { serverNow } from '@/api/clock';
import { useDevices } from '@/api/devices';
import { useDiaryLayer } from '@/api/layers';
import { noLongerThere } from '@/api/problem';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useTimeline } from '@/api/timeline';
import { useCorrecting } from '@/log/corrections';
import { ageLabel } from '@/ui/age';
import { EntryRow } from '@/ui/EntryRow';
import { foldRepeats, readingNamesOf } from '@/ui/entries';
import { maintenanceQuiet, parksAnything, type Quiet } from '@/ui/maintenance';
import { LoadFailed, NoLongerHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, useZone } from '@/ui/zone';
import { MaintenanceButton } from '../devices/Maintenance';
import { livenessOf, measuredAtOf } from '../home/attention';
import { DiaryOffer } from '../home/DiaryOffer';
import { LivenessPill } from '../home/LivenessPill';
import { OfflineHelp } from '../home/OfflineHelp';
import { NotifyNotice } from '../notifications/NotifyNotice';
import { GrowBlock } from './GrowBlock';
import { climateDeviceOf, focusLink, KIND_ICON, statusOf, statusText, toneOf, type Status } from './place';
import { PlaceMenu } from './PlaceMenu';
import { usePlace, useDeviceLive } from './reads';
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
  const devices = useDevices(hasDevice);
  const here = (devices.data?.items ?? []).filter(device => overview.deviceIds?.includes(device.id));
  const device = climateDeviceOf(here, overview.deviceIds);
  const live = useDeviceLive(device?.id ?? null).data;
  const timeline = useTimeline(hasDevice ? spaceId : '', '24h', null).data;
  const mayManage = useMayManage(spaceId);
  const me = useMe(false, user !== null && user.isDemo !== true);
  // The grow waits for the account's answer rather than flashing up for somebody who keeps no diary; the demo is shown it whole.
  const diary = useDiaryLayer() && (me.data !== undefined || user?.isDemo === true);
  const liveness = livenessOf(overview, now);
  const offline = liveness === 'offline';
  const status = statusOf({ ...overview, quiet: quietOf(here, now) }, now);
  // Offered once the account has been read, and only where nobody said no; the demo has no account to keep an answer with.
  const offerDiary = me.data !== undefined && !me.data.layers.diary && me.data.preferences.diary !== 'off';
  const Icon = KIND_ICON[overview.kind];

  // Verlauf and Steuerung land on the place last looked at, and looking at one here is what makes it that place.
  useRememberPlace(spaceId);

  return (
    <section className={styles.cockpit} aria-label={headed ? undefined : overview.name} aria-labelledby={headed ? `${spaceId}-name` : undefined}>
      {headed ? (
        <header className={styles.head}>
          {back ? (
            <Link to="/" className={ui.back} aria-label={t('shell.tabs.home')}>
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          <h1 className={styles.name} id={`${spaceId}-name`}>
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span>{overview.name}</span>
          </h1>
          <LivenessPill liveness={liveness} measuredAt={measuredAtOf(overview.values)} now={now} explain />
          <PlaceMenu overview={overview} />
        </header>
      ) : null}
      {headed ? <RefreshFailed failedAt={failedAt} now={now} /> : null}

      <div className={styles.columns}>
        <div className={styles.column}>
          <StatusLine status={status} overview={overview} now={now} zone={zone} mayManage={mayManage} />
          {hasDevice ? <NotifyNotice later /> : null}
          {hasDevice ? (
            <Tiles
              spaceId={spaceId}
              values={overview.values}
              setpoints={overview.setpoints}
              device={device}
              live={live}
              timeline={timeline}
              now={now}
              offline={offline}
            />
          ) : null}
          {overview.cameras.length > 0 ? <CameraBlock overview={overview} now={now} zone={zone} /> : null}
          {/* Offered only where it can do what it says: an offline device would not hear it, and a plug parks nothing. */}
          {mayManage && !offline && here.some(parksAnything) ? (
            <div className={styles.actions}>
              <MaintenanceButton devices={here} now={now} className={ui.quiet} />
            </div>
          ) : null}
        </div>

        <div className={styles.column}>
          {hasDevice ? <TargetsSummary spaceId={spaceId} targets={overview.targets} device={device} now={now} mayChange={mayManage} /> : null}
          {hasDevice && here.length > 0 ? <AlarmsSummary spaceId={spaceId} devices={here} me={me.data} mayChange={mayManage} /> : null}
          {diary ? <GrowBlock overview={overview} still={newestStill(overview)} now={now} /> : null}
          <Latest overview={overview} now={now} />
          {offerDiary ? <DiaryOffer /> : null}
        </div>
      </div>
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
 */
function StatusLine({
  status,
  overview,
  now,
  zone,
  mayManage,
}: {
  status: Status;
  overview: SpaceOverview;
  now: DateTime;
  zone: string | null;
  mayManage: boolean;
}) {
  const { t } = useTranslation();

  if (status.kind === 'offline') {
    return (
      <OfflineHelp since={measuredAtOf(overview.values)} now={now} devicesLink={overview.deviceIds === null ? null : devicesPath(overview.spaceId)} />
    );
  }
  if (status.kind === 'none') {
    return (
      <p className={styles.status} data-tone="quiet">
        <Info size={18} strokeWidth={2} aria-hidden />
        <span>{t('home.invite.noSensor')}</span>
        <Link to="/claim" className={ui.headLink}>
          {t('home.invite.addDevice')} ›
        </Link>
      </p>
    );
  }

  const Icon = STATUS_ICON[status.kind];
  const text = statusText(t, status, now, zone);
  const to =
    status.kind === 'alert'
      ? '/alerts'
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

/** The newest picture any camera here took, which a grow without a cover of its own is shown by. */
const newestStill = (overview: SpaceOverview): string | null =>
  [...overview.cameras].sort((one, other) => (other.lastStillAt ?? '').localeCompare(one.lastStillAt ?? ''))[0]?.stills.at(-1)?.mediaId ?? null;

/** The newest picture of the place, a tap from the camera's own page. */
function CameraBlock({ overview, now, zone }: { overview: SpaceOverview; now: DateTime; zone: string | null }) {
  const { t } = useTranslation();
  const camera = [...overview.cameras].sort((one, other) => (other.lastStillAt ?? '').localeCompare(one.lastStillAt ?? ''))[0];
  // Today's strip is empty before the first picture of the day; the camera's newest frame is then the one from yesterday.
  const latest = useLatestStills(camera.lastStillAt && camera.stills.length === 0 ? [camera.cameraId] : []);
  const mediaId = camera.stills.at(-1)?.mediaId ?? latest.get(camera.cameraId) ?? null;
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null;
  const takenAt = camera.stills.at(-1)?.capturedAt ?? camera.lastStillAt;

  return (
    <Link to={`/cameras/${camera.cameraId}`} className={styles.camera} aria-label={t('cockpit.camera.open')}>
      {src ? (
        <img src={src} alt={t('home.card.stillAlt', { name: overview.name })} loading="lazy" />
      ) : (
        <span className={styles.cameraEmpty}>{t('cockpit.camera.none')}</span>
      )}
      <span className={`mono ${styles.cameraCaption}`}>
        <Camera size={14} strokeWidth={1.75} aria-hidden />
        <span>{takenAt ? t('cockpit.camera.caption', { time: clock(takenAt, zone), age: ageLabel(takenAt, now) }) : t('cockpit.camera.title')}</span>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </span>
    </Link>
  );
}

/** How many of the newest lines the cockpit names; the Timeline has the rest. */
const LATEST = 3;

/** The last three things that happened here, each in one plain line. */
function Latest({ overview, now }: { overview: SpaceOverview; now: DateTime }) {
  const { t } = useTranslation();
  const correcting = useCorrecting();
  const folded = foldRepeats(overview.entries).slice(0, LATEST);

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
          {folded.map(({ entry, count, since }) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              repeats={{ count, since }}
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
