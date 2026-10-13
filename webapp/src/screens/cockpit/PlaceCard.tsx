import { CircleCheck, Clock, Info, Leaf, Power, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { placePath } from '@/app/places';
import type { CardSetpoint, CardValue, Device, DeviceLive, HomeClimate, HomeSpaceCard, Metric } from '@fg2/shared-types/v1';
import { deviceTitle } from '@/ui/naming';
import { serverNow } from '@/api/clock';
import { DevicesHere } from './DevicesHere';
import { useDeviceLive, useHourMeans } from '@/api/devices';
import { ageAttribute, valueAge } from '@/ui/age';
import { maintenanceQuiet, type Quiet } from '@/ui/maintenance';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { ownStatusOf } from '../control/devices/own-summary';
import { livenessOf, measuredAtOf } from '../home/attention';
import { LivenessPill } from '../home/LivenessPill';
import { decimalFigure } from '@/ui/figures';
import { figure, figureWithUnit, UNIT } from '@/ui/units';
import {
  climateDeviceOf,
  controlOffOf,
  KIND_ICON,
  halfNowOf,
  humidifierOutputs,
  judgedOf,
  lightWindowOf,
  outputsFor,
  setpointOf,
  statusOf,
  statusText,
  toneOf,
  valueOf,
  type HumidifierHold,
  type Status,
} from './place';
import { useHumidifierHold } from './reads';
import { useHumidifiers } from '../control/germination/germination-choices';
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
  // The lamp is the climate device's own output, or else a light of its own in the same place.
  const lamp = here.find(one => one.type === 'light' && one.id !== device?.id) ?? null;
  const lampLive = useDeviceLive(lamp?.id ?? null).data;
  const lit = live?.outputs.light?.value != null ? live : lampLive?.outputs.light?.value != null ? lampLive : null;
  const quiet = here.map(one => maintenanceQuiet(one, DateTime.max(now, serverNow()))).find((one): one is Quiet => one !== null) ?? null;
  const humidifierHold = useHumidifierHold(device);
  // A place holding several climates is said climate by climate: the worst of
  // them speaks for the card, named by its device, and each has its own figures.
  const several = card.climates.length > 1;
  const climates = card.climates.map(climate => {
    const mine = here.filter(one => one.id === climate.deviceId);
    const status = statusOf(
      {
        ...card,
        values: climate.values,
        setpoints: climate.setpoints,
        deviceIds: [climate.deviceId],
        quiet,
        controlOff: controlOffOf(mine),
        humidifierHold: null,
      },
      now,
    );
    return { climate, device: mine[0] ?? null, status };
  });
  const worst = several ? [...climates].sort((a, b) => TONE_RANK[toneOf(b.status)] - TONE_RANK[toneOf(a.status)])[0] : null;
  const status = worst?.status ?? statusOf({ ...card, quiet, controlOff: controlOffOf(here), humidifierHold }, now);
  const Icon = card.kind === null ? Leaf : KIND_ICON[card.kind];
  const StatusIcon = STATUS_ICON[status.kind] ?? Info;
  const said =
    (status.kind === 'noTargets' ? ownStatusOf(t, worst?.device ?? device, offsetOf(now, zone)) : null) ?? statusText(t, status, now, zone);

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
        <span>{worst?.device && status.kind !== 'alert' ? `${deviceTitle(worst.device, t, devices)} · ${said}` : said}</span>
      </p>
      {several ? (
        climates.map(({ climate, device: one, status: own }) => (
          <CardClimate key={climate.deviceId} climate={climate} device={one} devices={devices} now={now} zone={zone} quiet={own.kind === 'offline'} />
        ))
      ) : (
        <Figures
          values={card.values}
          setpoints={card.setpoints}
          deviceId={device?.id ?? null}
          hold={humidifierHold}
          lamp={status.kind === 'offline' ? null : lit}
          now={now}
        />
      )}
      {several ? null : <DeviceLine device={device} live={live} now={now} zone={zone} quiet={status.kind === 'offline'} />}
      <DevicesHere spaceId={card.spaceId} devices={here} lead={climates[0]?.device ?? device} linked={false} />
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

/** One climate of several on a card: its device's name, its figures and what its outputs are doing. */
function CardClimate({
  climate,
  device,
  devices,
  now,
  zone,
  quiet,
}: {
  climate: HomeClimate;
  device: Device | null;
  devices: Device[] | undefined;
  now: DateTime;
  zone: string | null;
  quiet: boolean;
}) {
  const { t } = useTranslation();
  const live = useDeviceLive(device?.id ?? null).data;

  return (
    <div className={styles.cardClimate}>
      <p className={styles.cardClimateName}>{device ? deviceTitle(device, t, devices) : null}</p>
      <Figures
        values={climate.values}
        setpoints={climate.setpoints}
        deviceId={climate.deviceId}
        hold={null}
        lamp={quiet ? null : (live ?? null)}
        now={now}
      />
      <DeviceLine device={device} live={live} now={now} zone={zone} quiet={quiet} />
    </div>
  );
}

/** How urgently a tone asks for a person, so the worst climate of several speaks for its card. */
const TONE_RANK: Record<ReturnType<typeof toneOf>, number> = { alarm: 3, warn: 2, quiet: 1, good: 0 };

/**
 * The readings a card has room for, each with its verdict and its last hour's
 * mean, and last how bright the lamp is. A dark lamp reads 0 %, which says it
 * as plainly as "aus"; when it switches stays in the device line below.
 */
function Figures({
  values,
  setpoints,
  deviceId,
  hold,
  lamp,
  now,
}: {
  values: CardValue[];
  setpoints: CardSetpoint[];
  deviceId: string | null;
  hold: HumidifierHold | null;
  /** What the device with the place's lamp last reported, if it has reported a level. */
  lamp: DeviceLive | null;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const means = useHourMeans(deviceId).data;
  const shown = SHOWN.flatMap(metric => {
    const value = valueOf(values, metric);
    return value ? [{ metric, value }] : [];
  });
  const level = lamp?.outputs.light?.value != null ? lamp.outputs.light : null;
  if (shown.length === 0 && !level) return null;

  return (
    <div className={styles.cardValues}>
      {shown.map(({ metric, value }) => {
        const verdict = judgedOf(value, setpointOf(setpoints, metric), hold, now);
        return (
          <span key={metric} className={styles.cardReading}>
            <span className={styles.cardValue} data-verdict={verdict?.kind} {...ageAttribute(valueAge(value, now))}>
              <span className="figure">{figure(value.value!, metric)}</span>
              <span className="mono">{UNIT[metric]}</span>
            </span>
            {means?.[metric] != null ? (
              <span className={`mono ${styles.mean}`}>{t('cockpit.tile.hourMean', { value: figureWithUnit(means[metric], metric) })}</span>
            ) : null}
          </span>
        );
      })}
      {level ? (
        <span className={styles.cardReading}>
          <span className={styles.cardValue} {...ageAttribute(valueAge(level, now))}>
            <span className="figure">{decimalFigure(Math.round(level.value!), 0)}</span>
            <span className="mono">%</span>
          </span>
          <span className={`mono ${styles.mean}`}>{t('cockpit.card.lightLevel')}</span>
        </span>
      ) : null}
    </div>
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
  const humidifiers = useHumidifiers(device);
  if (!device || !live || quiet) return null;
  const window = lightWindowOf(device, now, zone);
  const light = live.outputs.light?.value;
  const outputs = [
    ...outputsFor(device, live, undefined, 'temperature'),
    ...outputsFor(device, live, undefined, 'humidity'),
    ...humidifierOutputs(humidifiers, 'humidity'),
    ...outputsFor(device, live, undefined, 'co2'),
  ].filter((state, index, all) => all.findIndex(other => other.output === state.output) === index);
  // Until when, only where the lamp keeps to its schedule: a day-long light has
  // no time to go off, and a lamp dark by day or lit by night switches when
  // somebody lets it, not at the end of the half.
  const half = halfNowOf(device, live, now, false);
  const parts = [
    light == null
      ? null
      : window?.always && light > 0
        ? t('cockpit.card.lightAlways')
        : window?.never && light <= 0
          ? t('cockpit.card.lightNever')
          : light > 0
            ? window && !window.always && half !== 'night'
              ? t('cockpit.card.lightOnUntil', { time: window.off })
              : t('cockpit.card.lightOn')
            : window && !window.never && half !== 'day'
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
