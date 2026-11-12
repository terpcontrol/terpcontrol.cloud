import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import type { Device } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { serverNow } from '@/api/clock';
import { useDeviceLive, useLiveReads, useSocketTables } from '@/api/devices';
import { useDevicePlans } from '@/api/plans';
import { useSession } from '@/api/session';
import { CONTROL_PAGES, controlPath, devicePath, type ControlPage, type PlaceCard } from '@/app/places';
import { PlaceTitle, VisitingTitle } from '@/screens/place/PlaceTitle';
import { deviceLiveness, sinceLabel } from '@/ui/age';
import { climateLanding } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { maintenanceQuiet } from '@/ui/maintenance';
import { deviceName } from '@/ui/naming';
import { OfflineBox } from '@/ui/OfflineHelp';
import { PageHead } from '@/ui/PageHead';
import { LoadFailed, Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import { useMayLogIn, useMayManage } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { clock, useZone } from '@/ui/zone';
import { Alarms } from './alarms/Alarms';
import { savedWords } from './climate/figures';
import { DevicesHere } from './DevicesHere';
import { leadOf, useLead } from './lead';
import { ModePage } from './Mode';
import { OutputsPage } from './Outputs';
import { OwnSettings } from './OwnSettings';
import { PlanPanel } from './PlanPanel';
import { alarmsLine, hasMode, hasOutputs, modeLine, outputsLine, outputsOf, pendingBehind, planLine, type RowLine } from './rows';
import styles from './Control.module.css';

const isSub = (value: string | null): value is ControlPage => (CONTROL_PAGES as readonly string[]).includes(value ?? '');

/**
 * Steuerung of one place: its climate on top - the light and the targets of
 * the device the server names as the place's climate - then a row each for
 * what watches over it, what sets the targets by itself, what the devices
 * drive and the mode they run in, and under them the devices standing there.
 *
 * It always opens on the climate, because that is what somebody with one tent
 * comes here to change; a plan that runs says so in its row, and one that
 * waits for an answer says it in amber. Each row is a page of its own in the
 * address, so an alert can link to the rule it came from and Back returns to
 * Steuerung. A device that is not heard locks nothing: settings are stored and
 * handed over when it connects, and the page says what it has not taken yet.
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
  const place = overview.data?.name ?? here?.name ?? '';

  if (sub !== null && !isSub(sub)) return <Navigate to={controlPath(spaceId)} replace />;

  const title = t('shell.tabs.control');
  const head = sub ? (
    <PageHead title={t(`control.page.${sub}`)} back={{ to: controlPath(spaceId), label: t('control.back') }} />
  ) : here ? (
    <PlaceTitle title={title} here={here} place={several ? place : null} state={lead ? <State lead={lead} devices={items} now={now} /> : null} />
  ) : (
    <VisitingTitle title={title} spaceId={spaceId} />
  );
  const framed = (body: ReactNode) => (
    <div className={sub ? styles.behind : styles.front}>
      {head}
      {body}
    </div>
  );

  if (devices.isPending || (overview.isPending && items.length > 0)) return framed(<Waiting lines={4} />);
  if (devices.failed) return framed(<LoadFailed retry={devices.refetch} />);

  if (sub === 'alarms') return framed(<Alarms spaceId={spaceId} devices={items} mayManage={mayManage} />);
  if (sub === 'plan') {
    return framed(
      <div className={styles.page}>
        {/* A plan belongs to a device, since what a step writes is that device's document: a place with two controllers has two. */}
        {items.map(device => (
          <PlanPanel key={device.id} device={device} mayManage={mayManage} landing={climateLanding(device)} />
        ))}
        {mayManage ? null : <p className={ui.note}>{t(mayLog ? 'space.control.youMayLog' : 'targets.readOnly')}</p>}
      </div>,
    );
  }
  if (sub === 'outputs') return framed(<OutputsPage spaceId={spaceId} devices={items} mayManage={mayManage} />);
  if (sub === 'mode') return framed(<ModePage devices={items} mayManage={mayManage} />);

  // A place with nothing to steer says so, with the way to add a device; a camera standing there is still listed.
  if (!lead) {
    return framed(
      <div className={styles.column}>
        {/* The one way to add a device is the button under it; a session that may add none is told only what is. */}
        <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.control.noController')}</p>
        <DevicesHere spaceId={spaceId} devices={items} lead={null} mayManage={mayManage} maySetUp={maySetUp} />
      </div>,
    );
  }

  return framed(
    <div className={styles.columns}>
      <div className={styles.column}>
        <h2 className={styles.label} data-wide>
          {t('control.climateIn', { place })}
        </h2>
        <Offline device={lead} now={now} />
        <OwnSettings device={lead} />
        <PageRows spaceId={spaceId} devices={items} lead={lead} now={now} />
        {/* The sheets and the steppers are absent for whoever may only look, which leaves figures that read as a page half drawn. */}
        {mayManage ? null : <p className={ui.note}>{t(mayLog ? 'space.control.youMayLog' : 'targets.readOnly')}</p>}
      </div>
      <div className={styles.column}>
        <h2 className={styles.label}>{t('control.devicesIn', { place })}</h2>
        <DevicesHere spaceId={spaceId} devices={items} lead={lead} mayManage={mayManage} maySetUp={maySetUp} />
      </div>
    </div>,
  );
}

/**
 * What the place's climate is doing as a whole, in the head where a live
 * place's age would stand: "Regelung ein", or what is away from it - switched
 * off, drying, germinating, parked for maintenance. A device without a control
 * of its own - a socket, a lamp - has no such state, and the place's age stays.
 */
function State({ lead, devices, now }: { lead: Device; devices: Device[]; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const control = lead.control;
  if (!control) return null;
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

  return (
    <span className={styles.pill} data-tone={warn ? 'warn' : undefined}>
      {text}
    </span>
  );
}

/**
 * A place whose climate device has gone quiet: since when, that everything can
 * be set all the same and when the device takes it over, and behind one tap
 * what to try. Nothing here can ask a silent device for anything, so the steps
 * are the grower's own.
 */
function Offline({ device, now }: { device: Device; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const spoke = heardAt(device.state.lastSeenAt, useLiveReads([device.id]).measuredAt.get(device.id) ?? null);
  // A device that has never been heard is waiting for its first values, not offline.
  if (spoke === null || deviceLiveness(spoke, now) !== 'offline') return null;
  const time = sinceLabel(spoke, now, zone);

  return (
    <OfflineBox title={t('offline.title', { device: deviceName(device, t), time })} deviceLink={devicePath(device.id)}>
      {t('control.offline.text', { time })}
    </OfflineBox>
  );
}

/**
 * The rows under the climate, each a page: the alarm rules, the grow plan, the
 * outputs and the work mode. A row whose page would hold nothing is not drawn -
 * a place of one socket has no plan a step could write into and no mode.
 */
function PageRows({ spaceId, devices, lead, now }: { spaceId: string; devices: Device[]; lead: Device; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const ids = devices.map(device => device.id);
  const rules = useAlarmRulesOf(ids);
  const plans = useDevicePlans(ids);
  const tables = useSocketTables(ids);
  const reads = useLiveReads(ids);
  const pending = useDeviceLive(lead.id).data?.pending?.settings ?? [];
  const outputs = devices.map(device => outputsOf(device, tables.tables.get(device.id), reads.levels.get(device.id) ?? null)).filter(hasOutputs);
  const moded = devices.find(hasMode) ?? null;
  const planned = plans.plans.length > 0 || devices.some(device => climateLanding(device) !== 'nowhere');
  const spoke = heardAt(lead.state.lastSeenAt, reads.measuredAt.get(lead.id) ?? null);
  const stand = spoke !== null && deviceLiveness(spoke, now) === 'offline' ? t('control.stand', { time: sinceLabel(spoke, now, zone) }) : null;
  const waits = (row: 'mode' | 'outputs', line: RowLine): RowLine => {
    const held = pendingBehind(pending, row);
    return held ? { text: `${line.text} · ${t('control.pending.behind', { saved: savedWords(t, held.savedAt, now, zone) })}`, warn: true } : line;
  };

  return (
    <nav aria-label={t('control.rows.label')}>
      <Rows grid>
        <PageRow
          to={controlPath(spaceId, 'alarms')}
          title={t('control.page.alarms')}
          line={rules.isPending ? null : alarmsLine(t, [...rules.rules.values()])}
        />
        {planned ? (
          <PageRow to={controlPath(spaceId, 'plan')} title={t('control.page.plan')} line={plans.isPending ? null : planLine(t, plans.plans, now)} />
        ) : null}
        {outputs.length > 0 ? (
          <PageRow
            to={controlPath(spaceId, 'outputs')}
            title={t('control.page.outputs')}
            line={waits('outputs', outputsLine(t, outputs, now, stand))}
          />
        ) : null}
        {moded ? <PageRow to={controlPath(spaceId, 'mode')} title={t('control.page.mode')} line={waits('mode', modeLine(t, moded))} /> : null}
      </Rows>
    </nav>
  );
}

function PageRow({ to, title, line }: { to: string; title: string; line: RowLine | null }) {
  return <Row to={to} title={title} line={line ? <Facts facts={line.text.split(' · ')} /> : null} warn={line?.warn} />;
}
