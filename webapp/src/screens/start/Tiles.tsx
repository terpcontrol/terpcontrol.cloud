import { ChevronRight, Droplets, Leaf, Sun, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, CardValue, Device, DeviceLive, OverviewTargets, SpaceTimeline, ValueState } from '@fg2/shared-types/v1';
import type { Steered } from '@fg2/shared-types/v1-schemas/steering.js';
import { useHourMeans } from '@/api/devices';
import { timelinePath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { ageAttribute, ageLabel, valueAge } from '@/ui/age';
import { darkReasonOf, darkSpellOf } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { decimalFigure } from '@/ui/figures';
import { Term } from '@/ui/Help';
import { Spoken } from '@/ui/Spoken';
import { figure, figureWithUnit, targetFigure, targetWithUnit } from '@/ui/units';
import { clock, useZone } from '@/ui/zone';
import ui from '@/ui/ui.module.css';
import { useHumidifiers } from '@/screens/control/germination/germination-choices';
import { storedShapeOf, type NowHolding } from '@/screens/control/targets/day-night';
import { DayBar } from './DayBar';
import { DayCurve } from './DayCurve';
import { humidifierOutputs, outputsFor, outputWords, type OutputState } from './outputs';
import {
  holdingNowOf,
  lightWindowOf,
  youngFrom,
  type CurveMetric,
  lightWindowSaid,
  lightWindowText,
  setpointOf,
  valueOf,
  verdictSaid,
  type HumidifierHold,
} from './place';
import { curvePath, darkOf, type Lamp, type Reading } from './readings';
import styles from './Tiles.module.css';

interface TilesProps {
  spaceId: string;
  /** What the place reads now (`readingsOf`): temperature, humidity, VPD, CO₂ and each lamp. */
  readings: Reading[];
  /** The values the readings were made from, for the leaf and the light that reaches it. */
  values: CardValue[];
  setpoints: CardSetpoint[];
  /** The day's and the night's targets as the device holds them now, which a curve borrows where its day has no band. */
  targets: OverviewTargets | null;
  /** The device that holds the place's climate, whose outputs move the readings. */
  device: Device | null;
  live: DeviceLive | undefined;
  lamps: readonly Lamp[];
  /** The last day of the lead (`useLastDay`), which every curve and output's run is read from. */
  day: SpaceTimeline | null;
  hold: HumidifierHold | null;
  now: DateTime;
  offline: boolean;
}

/**
 * The readings of a place as tiles, one per thing a grower watches - master's
 * cockpit on the new page: the figure, its last hour, what it is aimed at now
 * and whether it is there, a day of it, and what the hardware is doing about
 * it. Temperature, humidity (with VPD), CO₂, each lamp and the leaf, in that
 * order, and only what the place measures: most places have four, a leaf
 * sensor is rare. The grid stands them by how many there are
 * (`Tiles.module.css`), and each tile lays itself out by its own width.
 */
export function Tiles(props: TilesProps) {
  const { readings, values, device, offline, now } = props;
  const climate = readings.filter((reading): reading is Reading & { key: Steered } => reading.key !== 'vpd' && reading.key !== 'light');
  const lights = readings.filter(reading => reading.key === 'light');
  const means = useHourMeans(device?.id ?? null, !offline && climate.length > 0).data;
  const humidifiers = useHumidifiers(device);
  const leaf = valueOf(values, 'leafTemperature') ?? valueOf(values, 'lux');
  // What "im Ziel" means is said on the first tile judged in band, and what a curve shows on the first curve.
  const explainBand = climate.find(reading => reading.verdict?.kind === 'in')?.key;
  if (climate.length + lights.length === 0 && !leaf) return null;

  return (
    <div className={styles.frame}>
      <div className={styles.tiles}>
        {climate.map((reading, index) => (
          <ClimateTile
            key={reading.key}
            {...props}
            reading={reading}
            vpd={reading.key === 'humidity' ? (readings.find(one => one.key === 'vpd') ?? null) : null}
            mean={means?.[reading.key] ?? null}
            outputs={[...outputsFor(device, props.live, props.day?.outputs, reading.key), ...humidifierOutputs(humidifiers, reading.key)]}
            explainBand={explainBand === reading.key}
            explainCurve={index === 0}
          />
        ))}
        {lights.map(reading => (
          <LightTile
            key={reading.deviceId}
            spaceId={props.spaceId}
            reading={reading}
            lamp={props.lamps.find(lamp => lamp.device.id === reading.deviceId)!}
            lead={device}
            now={now}
            offline={offline}
          />
        ))}
        {leaf ? <LeafTile {...props} dark={darkOf(readings, values)} /> : null}
      </div>
    </div>
  );
}

/**
 * A tile is one press target: its name is the link, stretched over the whole
 * tile, so a screen reader hears one link named after the reading and a tap
 * anywhere on it opens the reading's curve. The words inside that explain
 * themselves stand above the stretch and keep their own press.
 */
function Tile({
  name,
  icon: Icon,
  to,
  tile,
  tone,
  figure: shown,
  lines,
  side,
  foot,
}: {
  name: string;
  icon: LucideIcon;
  to: string;
  tile: string;
  tone?: Reading['tone'];
  figure: ReactNode;
  lines: ReactNode;
  /** The curve, or the lamp's day. */
  side: ReactNode;
  foot: ReactNode;
}) {
  return (
    <article className={styles.tile} data-tile={tile} data-tone={tone}>
      <div className={styles.inner}>
        <Link to={to} className={styles.name}>
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          {name}
          <ChevronRight size={13} strokeWidth={2} className={styles.chevron} aria-hidden />
        </Link>
        <div className={styles.figure}>{shown}</div>
        <div className={styles.lines}>{lines}</div>
        <div className={styles.side}>{side}</div>
        <div className={styles.foot}>{foot}</div>
      </div>
    </article>
  );
}

/** The big figure and its unit, drawn, and the figure with what goes with it said as one sentence. */
function Figure({ number, unit, said, age }: { number: string; unit: string | null; said: string; age: ValueState }) {
  return (
    <span className={styles.reading} {...ageAttribute(age)}>
      <span className={styles.value} aria-hidden>
        {number}
      </span>
      {unit ? (
        <span className={styles.unit} aria-hidden>
          {unit}
        </span>
      ) : null}
      <span className={ui.visuallyHidden}>{said}</span>
    </span>
  );
}

function ClimateTile({
  spaceId,
  reading,
  vpd,
  mean,
  outputs,
  setpoints,
  targets,
  device,
  live,
  day,
  hold,
  now,
  offline,
  explainBand,
  explainCurve,
}: TilesProps & {
  reading: Reading & { key: Steered };
  vpd: Reading | null;
  mean: number | null;
  outputs: OutputState[];
  explainBand: boolean;
  explainCurve: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const metric = reading.key;
  const range = reading.range ?? null;
  const label = range
    ? { long: t('start.tile.switches', { low: targetFigure(range.low, metric), high: targetWithUnit(range.high, metric) }), short: null }
    : targetLabel(
        t,
        metric,
        setpointOf(setpoints, metric),
        holdingNowOf(device, live, now, offline),
        device,
        offline,
        metric === 'humidity' ? hold : null,
      );
  const meanSaid = mean === null ? null : figureWithUnit(mean, metric);
  // The day's caption on the first curve: "24 Std", or since when for a record younger than a day.
  const young = explainCurve && day ? youngFrom(day, metric) : null;
  const caption = explainCurve && day ? (young ? t('start.tile.since', { time: clock(young, zone) }) : t('start.tile.day')) : null;

  return (
    <Tile
      name={reading.label}
      icon={ICON[metric]}
      to={curvePath(spaceId, reading)}
      tile={metric}
      tone={reading.tone}
      figure={
        <>
          <Figure
            number={reading.number}
            unit={reading.unit}
            age={reading.age}
            said={[reading.figure, meanSaid ? t('spoken.hourMean', { value: meanSaid }) : null].filter(Boolean).join(', ')}
          />
          {/* VPD stands beside the humidity it is worked out from, as on master; a stale one is not there at all. */}
          {vpd && vpd.age === 'live' ? (
            <span className={styles.second}>
              <Term topic="vpd">{t('home.metric.vpd')}</Term> <span className={styles.secondValue}>{vpd.number}</span>
            </span>
          ) : null}
        </>
      }
      lines={
        <>
          {meanSaid ? (
            <p className={styles.line} aria-hidden>
              {t('start.tile.hourMean')} <span className={styles.ink}>{meanSaid}</span>
            </p>
          ) : null}
          {/* The target and the verdict break between them where they do not fit one line: an ellipsis cut "6,5 °C zu ho…". */}
          <Facts
            className={styles.target}
            facts={[
              label.short ? (
                <span key="target">
                  <span className={styles.long}>{label.long}</span>
                  <span className={styles.short}>{label.short}</span>
                </span>
              ) : (
                label.long
              ),
              reading.verdict ? <VerdictWords key="verdict" reading={reading} now={now} explain={explainBand} /> : null,
            ]}
          />
        </>
      }
      side={<DayCurve timeline={day} targets={targets} metric={metric as CurveMetric} label={reading.label} />}
      foot={
        <>
          {offline ? null : <Outputs outputs={outputs} now={now} age={reading.age} />}
          {caption ? (
            <span className={styles.caption}>
              <Term topic="dayCurve">{caption}</Term>
            </span>
          ) : null}
        </>
      }
    />
  );
}

const ICON: Record<Steered | 'light' | 'leaf', LucideIcon> = { temperature: Thermometer, humidity: Droplets, co2: Wind, light: Sun, leaf: Leaf };

/** Why a device holds no target at all for a reading, where the reason is the mode it runs. */
const unheldBy = (device: Device | null): 'off' | 'drying' | 'germination' | 'greenhouse' | null =>
  darkReasonOf(device) ?? (device?.control?.mode === 'greenhouse' ? 'greenhouse' : null);

/**
 * "Tagesziel 25 °C": the target of the half the device holds now - by its
 * clock and its mode, never by whether the lamp shines - which is the target
 * the verdict beside it is judged by, with the short form a narrow tile takes
 * ("Ziel 25 °C"). CO₂ is dosed by day only, so at night it says it has none
 * rather than looking unset. Where the device has no day and night the target
 * is named by what it holds instead: a drying room's, a germination's, and at
 * 24 or 0 hours of light simply the target. While a fridge glides between its
 * halves the figure is the one it has glided to, and for a device not heard
 * from the half is the one its schedule would put it in, which is said too.
 */
const targetLabel = (
  t: Translate,
  metric: Steered,
  setpoint: CardSetpoint | null,
  holding: NowHolding | null,
  device: Device | null,
  offline: boolean,
  /** The humidity a humidifier socket holds while the device germinates, where it holds one. */
  hold: HumidifierHold | null,
): { long: string; short: string | null } => {
  const one = (long: string) => ({ long, short: null });
  const half = holding?.half ?? null;
  const regime = storedShapeOf(device)?.regime ?? null;
  // A device drying, germinating or switched off holds no target here because of what it is doing, which is said:
  // "nachts kein Ziel" over a drying room's CO₂ read as though night were the reason.
  const by = unheldBy(device);
  if (setpoint?.value == null && by === 'germination' && hold !== null) {
    return one(t('start.tile.humidifierHolds', { target: targetWithUnit(hold.target, 'humidity') }));
  }
  if (setpoint?.value == null && by) return one(t('start.tile.noTargetBy', { mode: t(`start.tile.mode.${by}`) }));
  if (setpoint?.value == null && metric === 'co2' && regime === 'never') return one(t('start.tile.co2Dark'));
  if (setpoint?.value == null) return one(t(metric === 'co2' && half === 'night' ? 'start.tile.co2Night' : 'start.tile.noTarget'));
  const target = targetWithUnit(setpoint.value, metric);
  if (regime === 'drying' || regime === 'germination') return one(t(`start.tile.target.${regime}`, { target }));
  if (regime === 'always' || regime === 'never' || !half) return one(t('start.tile.target.any', { target }));
  if (holding?.glide && !offline && metric !== 'co2') return one(t(`start.tile.target.gliding.${holding.glide.to}`, { target }));
  if (offline) return one(t(`start.tile.target.bySchedule.${half}`, { target }));
  return { long: t(`start.tile.target.${half}`, { target }), short: t('start.tile.target.any', { target }) };
};

/** "im Ziel" in green, how far off in the warning's ink, on its way between day and night, or the last value's age. */
function VerdictWords({ reading, now, explain }: { reading: Reading & { key: Steered }; now: DateTime; explain: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const verdict = reading.verdict;
  if (!verdict) return null;
  const words = verdictSaid(t, verdict, reading.key, now, zone);
  if (verdict.kind === 'in') return <span className={styles.good}>{explain ? <Term topic="band">{words}</Term> : words}</span>;
  if (verdict.kind === 'last') return <span>{words}</span>;
  return <span className={styles.off}>{verdict.kind === 'settling' ? <Term topic="band">{words}</Term> : words}</span>;
}

/** "Heizung aus", "Kompressor läuft seit 12 Min": what moves this reading, each output by its one name, a dot for each. */
function Outputs({ outputs, now, age }: { outputs: OutputState[]; now: DateTime; age: ValueState }) {
  const { t } = useTranslation();
  if (outputs.length === 0) return null;

  return (
    <ul className={styles.outputs} {...ageAttribute(age)}>
      {outputs.map(state => (
        <li key={state.output} className={styles.output} data-on={state.on ? 'output' : undefined}>
          {outputWords(t, state, state.since ? ageLabel(state.since, now) : null)}
        </li>
      ))}
    </ul>
  );
}

/**
 * A lamp: on or off and how bright, today's window as a bar with now on it,
 * and when it next switches - or why it does not keep to its window: held by
 * hand, burning in the dark of a germination, dark for the work mode. A lamp
 * nobody has heard from in ten minutes is said in the past: a big "An 100 %"
 * at nine in the evening from a fridge silent since the morning read as the
 * light being on now. Each lamp of a place is a tile of its own, named.
 */
function LightTile({
  spaceId,
  reading,
  lamp,
  lead,
  now,
  offline,
}: {
  spaceId: string;
  reading: Reading;
  lamp: Lamp;
  lead: Device | null;
  now: DateTime;
  offline: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const on = reading.lit === true;
  const gone = reading.age === 'offline';
  // A lamp module goes by its place's work mode; the climate device's own lamp is dark while its regulation is off too.
  const dark = lamp.device.id === lead?.id ? darkReasonOf(lead) : darkSpellOf(lead);
  const window = dark ? null : lightWindowOf(lamp.device, now, zone);
  const why = reading.age !== 'live' ? reading.note : ((reading.despite ? reading.note : null) ?? reading.held ?? reading.switches ?? null);

  return (
    <Tile
      name={reading.label}
      icon={Sun}
      to={curvePath(spaceId, reading)}
      tile="light"
      figure={
        <span className={styles.reading} {...ageAttribute(reading.age)}>
          <span className={styles.value}>
            {t(gone ? (on ? 'start.light.wasOn' : 'start.light.wasOff') : on ? 'start.light.on' : 'start.light.off')}
          </span>
          {on && !gone ? <span className={styles.level}>{`${decimalFigure(Math.round(lamp.level.percent), 0)} %`}</span> : null}
        </span>
      }
      lines={
        <>
          <p className={styles.line}>
            {window ? (
              <Term topic="dayNight">
                <Spoken said={lightWindowSaid(t, window)}>{lightWindowText(t, window)}</Spoken>
              </Term>
            ) : (
              t(dark ? `start.light.dark.${dark}` : 'start.light.noWindow')
            )}
          </p>
          {why ? <p className={styles.line}>{why}</p> : null}
        </>
      }
      side={window ? <DayBar window={window} now={now} zone={zone} /> : null}
      foot={
        offline ? null : (
          <ul className={styles.outputs} {...ageAttribute(reading.age)}>
            <li className={styles.output} data-on={on ? 'lamp' : undefined}>
              {`${t('start.output.lamp')} ${t(on ? 'start.outputs.on' : 'start.outputs.off')}`}
            </li>
          </ul>
        )
      }
    />
  );
}

/**
 * What the canopy itself reads: the leaf against the air around it, and the
 * light that reaches it - left out while the lamp is dark, where "0 lx · PPFD
 * 0" says nothing the lamp has not said. It leads with the light where nothing
 * measures the leaf.
 */
function LeafTile({ spaceId, values, day, now, dark }: TilesProps & { dark: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const leaf = valueOf(values, 'leafTemperature');
  const lux = valueOf(values, 'lux');
  const ppfd = dark ? null : valueOf(values, 'ppfd');
  const air = valueOf(values, 'temperature');
  const lead = (leaf ?? lux)!;
  const metric = leaf ? 'leafTemperature' : 'lux';
  const age = valueAge(lead, now);
  const offset = leaf && air ? leaf.value! - air.value! : null;
  const light = [
    lux && leaf && !dark ? t('start.leaf.lux', { value: figure(lux.value!, 'lux') }) : null,
    ppfd ? t('start.leaf.ppfd', { value: decimalFigure(Math.round(ppfd.value!), 0) }) : null,
  ];

  return (
    <Tile
      name={t('start.tile.leaf')}
      icon={Leaf}
      to={timelinePath(spaceId, metric)}
      tile="leaf"
      figure={<Figure number={figure(lead.value!, metric)} unit={leaf ? '°C' : 'lx'} age={age} said={figureWithUnit(lead.value!, metric)} />}
      lines={
        <>
          {age !== 'live' ? (
            <p className={styles.line}>{verdictSaid(t, { kind: 'last', at: lead.measuredAt }, metric, now, zone)}</p>
          ) : offset !== null ? (
            <p className={styles.line}>{t(offsetKey(offset), { value: figure(Math.abs(offset), 'temperature') })}</p>
          ) : null}
          {light.some(Boolean) ? (
            <p className={styles.line}>
              {light[0]}
              {light[0] && light[1] ? ' · ' : null}
              {light[1] ? <Term topic="ppfd">{light[1]}</Term> : null}
            </p>
          ) : null}
        </>
      }
      side={leaf ? <DayCurve timeline={day} targets={null} metric="leafTemperature" label={t('home.metric.leafTemperature')} /> : null}
      foot={null}
    />
  );
}

/** A tenth of a degree either way is the sensor and not the leaf. */
const offsetKey = (offset: number): string => (Math.abs(offset) < 0.1 ? 'start.leaf.same' : offset < 0 ? 'start.leaf.cooler' : 'start.leaf.warmer');
