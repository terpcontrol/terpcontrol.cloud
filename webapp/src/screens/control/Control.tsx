import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { serverNow } from '@/api/clock';
import { useLiveReads, useSocketTables } from '@/api/devices';
import { useDevicePlans } from '@/api/plans';
import { useSession } from '@/api/session';
import { CONTROL_PAGES, controlPath, devicePath, type ControlPage, type PlaceCard } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { PlaceTitle, VisitingTitle } from '@/screens/place/PlaceTitle';
import { deviceLiveness, sinceLabel } from '@/ui/age';
import { climateLanding } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { useKeptScroll } from '@/ui/kept';
import { maintenanceQuiet } from '@/ui/maintenance';
import { deviceName } from '@/ui/naming';
import { OfflineBox } from '@/ui/OfflineHelp';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { useMayLogIn, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, useZone } from '@/ui/zone';
import { Alarms } from './alarms/Alarms';
import { ByDevice, NothingHere } from './ByDevice';
import { DevicesHere } from './DevicesHere';
import { inOrder, leadOf, useLead } from './lead';
import { ModePage } from './Mode';
import { OutputsPage } from './Outputs';
import { OwnSettings } from './OwnSettings';
import { PageRows } from './PageRows';
import { PlanPanel } from './PlanPanel';
import { planLine, standOf } from './rows';
import styles from './Control.module.css';

const isSub = (value: string | null): value is ControlPage => (CONTROL_PAGES as readonly string[]).includes(value ?? '');

/**
 * Steuerung of one place: the light and the targets of the device the server
 * names as the place's climate, then a row each for the alarms, the plan, the
 * outputs and the work mode, and under them the devices standing there.
 *
 * Each row is a page of its own in the address, so an alert can link to the
 * rule it came from and Back returns to Steuerung where it was left. A device
 * that is not heard locks nothing: settings are stored and handed over when it
 * connects, and the page says what it has not taken yet.
 */
export function Control({
  spaceId,
  sub,
  here = null,
  several = false,
}: {
  spaceId: string;
  sub: string | null;
  /** The home's card of the place, which dates it; null where support reads a customer's place. */
  here?: PlaceCard | null;
  /** Whether the account has several places, so the page names the one it is about. */
  several?: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  // Everything here writes to a device standing in this place, so the question is about the place and not the session.
  const mayManage = useMayManage(spaceId);
  const mayLog = useMayLogIn(spaceId);
  // Adding hardware is the session's own to do, and offered where the place is the reader's to steer: under somebody else's tent it would read as adding to theirs.
  const maySetUp = useMayManage() && mayManage && user?.isDemo !== true;
  const { devices, overview, lead: named } = useLead(spaceId);
  const items = devices.items;
  // A place that could not be read whole still has a climate: the first device that states one.
  const lead = named ?? (overview.isPending ? null : leadOf(items, undefined));
  const ordered = inOrder(items, lead);
  const place = overview.data?.name ?? here?.name ?? '';
  const waiting = devices.isPending || (overview.isPending && items.length > 0);
  const spoke = heardAt(lead?.state.lastSeenAt ?? null, useLiveReads(lead ? [lead.id] : []).measuredAt.get(lead?.id ?? '') ?? null);
  // The socket rows stand at the page's foot: where it was scrolled to is found again once they are there.
  const tables = useSocketTables(sub === null ? ordered.map(device => device.id) : []);
  useKeptScroll(!waiting && !tables.isPending);

  if (sub !== null && !isSub(sub)) return <Navigate to={controlPath(spaceId)} replace />;

  const title = t('shell.tabs.control');
  const head = sub ? (
    <PageHead title={t(`control.page.${sub}`)} back={{ to: controlPath(spaceId), label: t('control.back') }} />
  ) : here ? (
    <PlaceTitle title={title} here={here} place={several ? place : null} state={lead ? stateOf(t, lead, items, spoke, now, zone) : null} />
  ) : (
    <VisitingTitle title={title} spaceId={spaceId} />
  );
  const framed = (body: ReactNode) => (
    <div className={sub ? styles.behind : styles.front}>
      {head}
      {body}
    </div>
  );
  // The sheets and the steppers are absent for whoever may only look, which leaves figures that read as a page half drawn.
  const reader = mayManage ? null : <p className={ui.note}>{t(mayLog ? 'space.control.youMayLog' : 'targets.readOnly')}</p>;

  if (waiting) return framed(<Waiting lines={4} />);
  if (devices.failed) return framed(<LoadFailed retry={devices.refetch} />);

  if (sub === 'alarms') return framed(<Alarms spaceId={spaceId} devices={ordered} mayManage={mayManage} />);
  if (sub === 'plan') {
    return framed(
      <>
        <PlanPage spaceId={spaceId} devices={ordered} mayManage={mayManage} now={now} />
        {reader}
      </>,
    );
  }
  if (sub === 'outputs') return framed(<OutputsPage spaceId={spaceId} devices={ordered} mayManage={mayManage} />);
  if (sub === 'mode') return framed(<ModePage spaceId={spaceId} devices={ordered} mayManage={mayManage} />);

  // A place with nothing to steer says so, with the way to add a device; a camera standing there is still listed.
  if (!lead) {
    return framed(
      <div className={styles.column}>
        {/* The one way to add a device is the button under it; a session that may add none is told only what is. */}
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('place.control.nothing')}</p>
        <DevicesHere spaceId={spaceId} devices={items} lead={null} mayManage={mayManage} maySetUp={maySetUp} />
      </div>,
    );
  }

  // The page names its place once: beside the title where the account has several, else over the two columns.
  const over = several
    ? { climate: t('control.climate'), devices: t('control.devices') }
    : { climate: t('control.climateIn', { place }), devices: t('control.devicesIn', { place }) };

  return framed(
    <div className={styles.columns}>
      <div className={styles.column}>
        <h2 className={styles.label} data-wide>
          {over.climate}
        </h2>
        <Offline device={lead} spoke={spoke} now={now} />
        <OwnSettings device={lead} />
        <PageRows spaceId={spaceId} devices={ordered} now={now} />
        {reader}
      </div>
      <div className={styles.column}>
        <h2 className={styles.label}>{over.devices}</h2>
        <DevicesHere spaceId={spaceId} devices={ordered} lead={lead} mayManage={mayManage} maySetUp={maySetUp} />
      </div>
    </div>,
  );
}

/**
 * What the place's climate is doing, in the head where a live place's age
 * would stand: "Regelung ein", or what is away from it. A lead with no control
 * of its own, or without its first values, leaves the place's age there. One
 * nobody hears is not said to regulate in green, also while another device
 * keeps the place live: its state stands as of when it was last heard.
 */
const stateOf = (t: Translate, lead: Device, devices: Device[], spoke: string | null, now: DateTime, zone: string | null): ReactNode => {
  const control = lead.control;
  if (!control || spoke === null) return null;
  const quiet = devices.map(device => maintenanceQuiet(device, DateTime.max(now, serverNow()))).find(one => one?.parked) ?? null;
  const [text, warn] = quiet
    ? [t('control.state.maintenance', { until: clock(quiet.until, zone) }), true]
    : !control.running
      ? [t('control.state.off'), true]
      : control.drying
        ? [t('control.state.drying'), true]
        : control.mode === 'germination'
          ? [t('control.state.germination'), true]
          : [t('control.state.on'), false];
  const stand = standOf(t, spoke, now, zone);

  return (
    <span className={styles.pill} data-tone={warn || stand ? 'warn' : undefined}>
      <Facts facts={[text, stand]} />
    </span>
  );
};

/**
 * The grow plan, device by device: a plan belongs to a device, since what a
 * step writes is that device's document. Only a device a plan could write a
 * climate into, or one that carries a plan all the same, is listed.
 */
function PlanPage({ spaceId, devices, mayManage, now }: { spaceId: string; devices: Device[]; mayManage: boolean; now: DateTime }) {
  const { t } = useTranslation();
  const plans = useDevicePlans(devices.map(device => device.id));
  const of = (device: Device) => plans.plans.filter(plan => plan.deviceId === device.id);
  const planned = devices.filter(device => climateLanding(device) !== 'nowhere' || of(device).length > 0);

  if (planned.length === 0) {
    return plans.isPending ? (
      <Waiting lines={3} />
    ) : (
      <NothingHere to={controlPath(spaceId)} where={t('control.back')}>
        {t('control.plan.none')}
      </NothingHere>
    );
  }

  return (
    <ByDevice devices={planned} line={device => planLine(t, of(device), now)}>
      {device => <PlanPanel device={device} mayManage={mayManage} landing={climateLanding(device)} />}
    </ByDevice>
  );
}

/**
 * A place whose climate device has gone quiet: since when, that everything
 * can be set all the same, and behind one tap what to try.
 */
function Offline({ device, spoke, now }: { device: Device; spoke: string | null; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  // A device that has never been heard is waiting for its first values, not offline.
  if (spoke === null || deviceLiveness(spoke, now) !== 'offline') return null;
  const time = sinceLabel(spoke, now, zone);

  return (
    <OfflineBox title={t('offline.title', { device: deviceName(device, t), time })} deviceLink={devicePath(device.id)}>
      {t('control.offline.text', { time })}
    </OfflineBox>
  );
}
