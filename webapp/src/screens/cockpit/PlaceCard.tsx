import { CircleCheck, Clock, Info, Leaf, Power, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { placePath } from '@/app/places';
import type { Device, HomeSpaceCard, Metric } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { ageAttribute, valueAge } from '@/ui/age';
import { maintenanceQuiet, type Quiet } from '@/ui/maintenance';
import { useZone } from '@/ui/zone';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/LivenessPill';
import { figure, UNIT } from '../home/units';
import {
  climateDeviceOf,
  controlOffOf,
  KIND_ICON,
  lightWindowOf,
  outputsFor,
  setpointOf,
  statusOf,
  statusText,
  toneOf,
  valueOf,
  verdictOf,
  type Status,
} from './place';
import { useDeviceLive } from './reads';
import styles from './Cockpit.module.css';

const STATUS_ICON: Partial<Record<Status['kind'], LucideIcon>> = {
  good: CircleCheck,
  off: TriangleAlert,
  alert: TriangleAlert,
  offline: TriangleAlert,
  maintenance: Wrench,
  controlOff: Power,
  stale: Clock,
};

/** The readings a card has room for, in the order the cockpit draws its tiles. */
const SHOWN: Metric[] = ['temperature', 'humidity', 'co2'];

/**
 * One place on the Start of an account with several: its name and pill, the
 * cockpit's own status sentence, the readings and what is running - and a tap
 * opens that place's cockpit. It says what the cockpit says, from the same
 * arithmetic, so the two never disagree about a tent.
 */
export function PlaceCard({
  card,
  devices,
  now,
  diary,
}: {
  card: HomeSpaceCard & { spaceId: string };
  devices: Device[] | undefined;
  now: DateTime;
  diary: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const here = (devices ?? []).filter(device => card.deviceIds.includes(device.id));
  const device = climateDeviceOf(here, card.deviceIds);
  const live = useDeviceLive(device?.id ?? null).data;
  const quiet = here.map(one => maintenanceQuiet(one, DateTime.max(now, serverNow()))).find((one): one is Quiet => one !== null) ?? null;
  const status = statusOf({ ...card, quiet, controlOff: controlOffOf(here) }, now);
  const Icon = card.kind === null ? Leaf : KIND_ICON[card.kind];
  const StatusIcon = STATUS_ICON[status.kind] ?? Info;
  const shown = SHOWN.flatMap(metric => {
    const value = valueOf(card.values, metric);
    return value ? [{ metric, value }] : [];
  });

  return (
    <article className={styles.placeCard} data-tone={toneOf(status)}>
      <header className={styles.cardHead}>
        <Link to={placePath(card.spaceId)} className={styles.cardName}>
          <Icon size={16} strokeWidth={1.75} aria-hidden />
          {card.name}
        </Link>
        <LivenessPill liveness={livenessOf(card, now)} measuredAt={measuredAtOf(card.values)} now={now} />
      </header>
      <p className={styles.cardStatus} data-tone={toneOf(status)}>
        <StatusIcon size={15} strokeWidth={2} aria-hidden />
        <span>{statusText(t, status, now, zone)}</span>
      </p>
      {shown.length > 0 ? (
        <div className={styles.cardValues}>
          {shown.map(({ metric, value }) => {
            const verdict = verdictOf(value, setpointOf(card.setpoints, metric), now);
            return (
              <span key={metric} className={styles.cardValue} data-verdict={verdict?.kind} {...ageAttribute(valueAge(value, now))}>
                <span className="figure">{figure(value.value!, metric)}</span>
                <span className="mono">{UNIT[metric]}</span>
              </span>
            );
          })}
        </div>
      ) : null}
      <DeviceLine device={device} live={live} now={now} zone={zone} quiet={status.kind === 'offline'} />
      {diary && card.grow ? (
        <p className={`mono ${styles.cardLine}`}>
          {[
            card.grow.name,
            card.grow.dayNumber !== null ? t('home.card.dayN', { day: card.grow.dayNumber }) : null,
            card.grow.stage ? t(`home.stage.${card.grow.stage}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </article>
  );
}

/** "Licht an bis 20:00 · Kompressor läuft · Heizung aus": the climate device's own report, in the cockpit's names. */
function DeviceLine({
  device,
  live,
  now,
  zone,
  quiet,
}: {
  device: Device | null;
  live: ReturnType<typeof useDeviceLive>['data'];
  now: DateTime;
  zone: string | null;
  quiet: boolean;
}) {
  const { t } = useTranslation();
  if (!device || !live || quiet) return null;
  const window = lightWindowOf(device, now, zone);
  const light = live.outputs.light?.value;
  const outputs = [
    ...outputsFor(device, live, undefined, 'temperature'),
    ...outputsFor(device, live, undefined, 'humidity'),
    ...outputsFor(device, live, undefined, 'co2'),
  ].filter((state, index, all) => all.findIndex(other => other.output === state.output) === index);
  const parts = [
    light == null
      ? null
      : light > 0
        ? window
          ? t('cockpit.card.lightOnUntil', { time: window.off })
          : t('cockpit.card.lightOn')
        : window
          ? t('cockpit.card.lightOffUntil', { time: window.on })
          : t('cockpit.card.lightOff'),
    ...outputs.map(
      state =>
        `${t(`cockpit.output.${state.word}`)} ${t(`cockpit.outputs.${state.word === 'co2' ? (state.on ? 'open' : 'closed') : state.on ? 'running' : 'off'}`)}`,
    ),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;

  return (
    <p className={`mono ${styles.cardLine}`}>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? ' · ' : ''}
          <span className={styles.part}>{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** A grow that stands in no place at all, which has no cockpit to open and opens at the grow. */
export function LooseGrowCard({ card }: { card: HomeSpaceCard }) {
  const { t } = useTranslation();
  const grow = card.grow;
  if (!grow) return null;

  return (
    <article className={styles.placeCard} data-tone="quiet">
      <header className={styles.cardHead}>
        <Link to={`/grows/${grow.growId}`} className={styles.cardName}>
          <Leaf size={16} strokeWidth={1.75} aria-hidden />
          {grow.name}
        </Link>
      </header>
      <p className={`mono ${styles.cardLine}`}>
        {[
          t('grow.noFixedPlace'),
          grow.dayNumber !== null ? t('home.card.dayN', { day: grow.dayNumber }) : null,
          grow.stage ? t(`home.stage.${grow.stage}`) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </article>
  );
}
