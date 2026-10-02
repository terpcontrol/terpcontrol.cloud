import { ChevronRight, Droplets, Leaf, Sun, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CardSetpoint, CardValue, Device, DeviceLive, Metric, OverviewTargets, SpaceTimeline, TimelinePanel } from '@fg2/shared-types/v1';
import { ageAttribute, ageLabel, valueAge } from '@/ui/age';
import { decimalFigure } from '@/ui/figures';
import { Term } from '@/ui/Help';
import { useZone } from '@/ui/zone';
import { LastValue } from '../home/OfflineHelp';
import { figure, targetFigure, UNIT } from '../home/units';
import { DayBar } from './DayBar';
import { MiniCurve, type Tone } from './MiniCurve';
import {
  focusLink,
  hoursFigure,
  judgedPanel,
  darkReasonOf,
  lightWindowOf,
  rangeVerdictOf,
  switchRangeOf,
  nightsOf,
  outputsFor,
  reports,
  setpointOf,
  valueOf,
  verdictOf,
  type OutputState,
  type Steered,
  type TileKey,
  type Verdict,
} from './place';
import { useDaySeries } from './reads';
import styles from './Cockpit.module.css';

/**
 * The readings of one place as tiles, one per thing a grower watches: the
 * value, what it is aimed at in the half of the cycle the device is in, whether
 * it is there, a day of it, and what the hardware is doing about it. Each tile
 * opens the Timeline on that reading.
 *
 * CO2 and the leaf-and-light tile are drawn only where the place reports them,
 * so a fridge without a sensor is never shown an empty tile it cannot fill.
 */
export interface TilesProps {
  spaceId: string;
  values: CardValue[];
  setpoints: CardSetpoint[];
  /** The day's and the night's targets as the controller holds them now, which the curves' bands are drawn from. */
  targets?: OverviewTargets | null;
  device: Device | null;
  live: DeviceLive | undefined;
  timeline: SpaceTimeline | undefined;
  now: DateTime;
  offline: boolean;
}

export function Tiles(props: TilesProps) {
  const { values, device, live } = props;
  const lit = lightWindowOf(device, props.now, null) !== null || live?.outputs.light?.value != null;
  // What "in band" means is said on the first tile that is judged against a band, and on no other.
  const judged = (['temperature', 'humidity', 'co2'] as Steered[]).find(
    metric => verdictOf(valueOf(values, metric), setpointOf(props.setpoints, metric), props.now)?.kind === 'in',
  );

  return (
    <div className={styles.tiles}>
      {reports(values, 'temperature') ? <ClimateTile {...props} metric="temperature" explainBand={judged === 'temperature'} explainCurve /> : null}
      {reports(values, 'humidity') ? <ClimateTile {...props} metric="humidity" explainBand={judged === 'humidity'} /> : null}
      {lit ? <LightTile {...props} /> : null}
      {reports(values, 'co2') ? <ClimateTile {...props} metric="co2" explainBand={judged === 'co2'} /> : null}
      {reports(values, 'leaf') ? <LeafTile {...props} /> : null}
    </div>
  );
}

const ICON: Record<TileKey, LucideIcon> = { temperature: Thermometer, humidity: Droplets, light: Sun, co2: Wind, leaf: Leaf };

/**
 * A tile is one press target: its name is the link, stretched over the whole
 * tile, so a screen reader hears one link named after the reading. The words
 * inside that explain themselves stand above the stretch and keep their own
 * press.
 */
function Frame({
  spaceId,
  tileKey,
  values,
  verdict,
  children,
}: {
  spaceId: string;
  tileKey: TileKey;
  /** What the place reads, for the one tile whose panel depends on it. */
  values?: CardValue[];
  verdict?: Verdict;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = ICON[tileKey];

  return (
    <article className={styles.tile} data-tile={tileKey} data-verdict={verdict?.kind === 'high' || verdict?.kind === 'low' ? 'off' : undefined}>
      <Link to={focusLink(spaceId, tileKey, values)} className={styles.tileName}>
        <Icon size={15} strokeWidth={1.75} aria-hidden />
        {t(`cockpit.metric.${tileKey}`)}
        <ChevronRight size={14} strokeWidth={2} className={styles.tileChevron} aria-hidden />
      </Link>
      {children}
    </article>
  );
}

const TONE: Record<Steered, Tone> = { temperature: 'temperature', humidity: 'humidity', co2: 'co2' };

function ClimateTile({
  spaceId,
  values,
  setpoints,
  targets = null,
  device,
  live,
  timeline,
  now,
  offline,
  metric,
  explainBand,
  explainCurve,
}: TilesProps & { metric: Steered; explainBand: boolean; explainCurve?: boolean }) {
  const { t } = useTranslation();
  const value = valueOf(values, metric);
  const setpoint = setpointOf(setpoints, metric);
  // A smart socket standing alone holds its reading between its switch points rather than at a target.
  const range = setpoint?.value == null ? switchRangeOf(device, metric, now) : null;
  const verdict = range ? rangeVerdictOf(value, range, now) : verdictOf(value, setpoint, now);
  const age = value ? valueAge(value, now) : 'offline';
  const vpd = metric === 'humidity' ? valueOf(values, 'vpd') : null;
  const panel = timeline
    ? judgedPanel(timeline.panels.find(one => one.metric === metric) ?? null, targets, timeline.startsAt, timeline.endsAt)
    : null;
  const outputs = outputsFor(device, live, timeline?.outputs, metric);

  return (
    <Frame spaceId={spaceId} tileKey={metric} verdict={verdict}>
      <div className={styles.tileText}>
        <div className={styles.figureLine} {...ageAttribute(age)}>
          <span className={`figure ${styles.figure}`}>{value?.value == null ? '–' : figure(value.value, metric)}</span>
          <span className={`mono ${styles.unit}`}>{UNIT[metric]}</span>
          {vpd?.value != null ? (
            <span className={`mono ${styles.second}`}>
              <Term topic="vpd">{t('cockpit.tile.vpd', { value: figure(vpd.value, 'vpd') })}</Term>
            </span>
          ) : null}
        </div>
        <p className={`mono ${styles.targetLine}`}>
          <span>
            {range
              ? t('cockpit.tile.switches', {
                  low: targetFigure(range.low, metric),
                  high: `${targetFigure(range.high, metric)} ${UNIT[metric] ?? ''}`.trim(),
                })
              : targetLabel(t, metric, setpoint, live)}
          </span>
          <VerdictWords verdict={verdict} metric={metric} now={now} explain={explainBand} />
        </p>
      </div>
      <div className={styles.tileCurve}>
        <MiniCurve
          panel={panel}
          nights={timeline?.nights ?? []}
          from={timeline ? Date.parse(timeline.startsAt) : 0}
          to={timeline ? Date.parse(timeline.endsAt) : 0}
          tone={TONE[metric]}
          label={t('cockpit.tile.curveAlt', { metric: t(`cockpit.metric.${metric}`) })}
          explain={explainCurve}
        />
      </div>
      {offline || outputs.length === 0 ? null : <Outputs outputs={outputs} now={now} age={age} explainCompressor={metric === 'temperature'} />}
    </Frame>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Tagesziel 25 °C": the target of the half of the cycle the device says it is
 * in, which is the target the verdict beside it is judged by. CO2 is raised
 * only while the lamp is on, so at night it says it has none rather than
 * looking unset.
 */
const targetLabel = (t: Translate, metric: Steered, setpoint: CardSetpoint | null, live: DeviceLive | undefined): string => {
  const half = live?.setpoints?.active ?? null;
  if (setpoint?.value == null) return t(metric === 'co2' && half === 'night' ? 'cockpit.tile.co2Night' : 'cockpit.tile.noTarget');
  const target = `${targetFigure(setpoint.value, metric)} ${UNIT[metric] ?? ''}`.trim();
  return t(half ? `cockpit.tile.target.${half}` : 'cockpit.tile.target.any', { target });
};

function VerdictWords({ verdict, metric, now, explain }: { verdict: Verdict; metric: Metric; now: DateTime; explain: boolean }) {
  const { t } = useTranslation();
  if (!verdict) return null;
  if (verdict.kind === 'last') {
    return (
      <span className={styles.lastValue}>
        <LastValue measuredAt={verdict.at} now={now} />
      </span>
    );
  }
  if (verdict.kind === 'in') {
    const words = t('home.card.inBand');
    return <span className={styles.inBand}>{explain ? <Term topic="band">{words}</Term> : words}</span>;
  }

  return (
    <span className={styles.offBand}>
      {t(`cockpit.tile.${verdict.kind}`, { delta: `${figure(verdict.delta, metric)} ${UNIT[metric] ?? ''}`.trim() })}
    </span>
  );
}

/** "Kompressor läuft seit 12 Min · Heizung aus": what moves this reading, each output by its one name. */
function Outputs({ outputs, now, age, explainCompressor }: { outputs: OutputState[]; now: DateTime; age: string; explainCompressor: boolean }) {
  const { t } = useTranslation();

  return (
    <ul className={`mono ${styles.outputs}`} data-age={age}>
      {outputs.map(state => {
        const name = t(`cockpit.output.${state.word}`);
        const named = explainCompressor && state.word === 'compressor' ? <Term topic="compressor">{name}</Term> : name;
        const key = state.word === 'co2' ? (state.on ? 'open' : 'closed') : state.on ? (state.since ? 'runningSince' : 'running') : 'off';
        return (
          <li key={state.output} className={styles.output} data-on={state.on || undefined}>
            <span className={styles.outputDot} aria-hidden />
            <span>
              {named} {t(`cockpit.outputs.${key}`, { age: state.since ? ageLabel(state.since, now) : '' })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The lamp: on or off and how bright, today's window as a bar with now on it, and when it next switches. */
function LightTile({ spaceId, device, live, now, offline }: TilesProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const window = lightWindowOf(device, now, zone);
  const dark = darkReasonOf(device);
  const level = live?.outputs.light ?? null;
  const age = level ? valueAge(level, now) : 'offline';
  const known = level?.value != null;
  const on = known && level.value! > 0;

  return (
    <Frame spaceId={spaceId} tileKey="light">
      <div className={styles.tileText}>
        <div className={styles.figureLine} {...ageAttribute(age)}>
          {/* A lamp nobody has heard from in ten minutes is said in the past:
              a big "An 100 %" at nine in the evening, from a fridge silent
              since the morning, read as the light being on now. */}
          <span className={`figure ${styles.figure}`}>
            {known
              ? t(age === 'offline' ? (on ? 'cockpit.light.wasOn' : 'cockpit.light.wasOff') : on ? 'cockpit.light.on' : 'cockpit.light.off')
              : '–'}
          </span>
          {on && age !== 'offline' ? <span className={`mono ${styles.second}`}>{`${decimalFigure(Math.round(level.value!), 0)} %`}</span> : null}
        </div>
        <p className={`mono ${styles.targetLine}`}>
          {window ? (
            <span>
              <Term topic="dayNight">{t('cockpit.light.window', { on: window.on, off: window.off, hours: hoursFigure(window.hours) })}</Term>
            </span>
          ) : (
            <span>{t(dark ? `cockpit.light.dark.${dark}` : 'cockpit.light.noWindow')}</span>
          )}
          {age !== 'live' && level ? (
            <span className={styles.lastValue}>
              <LastValue measuredAt={level.measuredAt} now={now} />
            </span>
          ) : window && known && !offline ? (
            <span>{t(on ? 'cockpit.light.offAt' : 'cockpit.light.onAt', { time: on ? window.off : window.on })}</span>
          ) : null}
        </p>
      </div>
      <div className={styles.tileCurve}>{window ? <DayBar window={window} now={now} zone={zone} /> : null}</div>
    </Frame>
  );
}

/** What the canopy itself reads: the leaf against the air around it, and the light that reaches it. */
function LeafTile({ spaceId, values, device, now }: TilesProps) {
  const { t } = useTranslation();
  const leaf = valueOf(values, 'leafTemperature');
  const lux = valueOf(values, 'lux');
  const ppfd = valueOf(values, 'ppfd');
  const air = valueOf(values, 'temperature');
  const lead = leaf ?? lux;
  const series = useDaySeries(device?.id ?? null, 'leafTemperature', leaf !== null).data;
  const age = lead ? valueAge(lead, now) : 'offline';
  const offset = leaf?.value != null && air?.value != null ? leaf.value - air.value : null;
  const luxLine = [
    lux?.value != null && leaf ? t('cockpit.leaf.lux', { value: figure(lux.value, 'lux') }) : null,
    ppfd?.value != null ? t('cockpit.leaf.ppfd', { value: decimalFigure(Math.round(ppfd.value), 0) }) : null,
  ].filter((part): part is string => part !== null);
  const panel: TimelinePanel | null = series ? { metric: 'leafTemperature', points: series.metrics[0]?.points ?? [], targets: [] } : null;

  return (
    <Frame spaceId={spaceId} tileKey="leaf" values={values}>
      <div className={styles.tileText}>
        <div className={styles.figureLine} {...ageAttribute(age)}>
          <span className={`figure ${styles.figure}`}>{lead?.value == null ? '–' : figure(lead.value, leaf ? 'leafTemperature' : 'lux')}</span>
          <span className={`mono ${styles.unit}`}>{leaf ? '°C' : 'lx'}</span>
        </div>
        <p className={`mono ${styles.targetLine}`}>
          {age !== 'live' && lead ? (
            <span className={styles.lastValue}>
              <LastValue measuredAt={lead.measuredAt} now={now} />
            </span>
          ) : offset !== null ? (
            <span>{t(offsetKey(offset), { value: figure(Math.abs(offset), 'temperature') })}</span>
          ) : null}
        </p>
        {luxLine.length > 0 ? (
          <p className={`mono ${styles.targetLine}`}>
            {luxLine.map((part, index) => (
              <span key={part}>{index === luxLine.length - 1 && ppfd?.value != null ? <Term topic="ppfd">{part}</Term> : part}</span>
            ))}
          </p>
        ) : null}
      </div>
      <div className={styles.tileCurve}>
        {leaf ? (
          <MiniCurve
            panel={panel}
            nights={series ? nightsOf(series.outputs.find(one => one.output === 'light')?.points, series.endsAt) : []}
            from={series ? Date.parse(series.startsAt) : 0}
            to={series ? Date.parse(series.endsAt) : 0}
            tone="leaf"
            label={t('cockpit.tile.curveAlt', { metric: t('cockpit.leaf.leaf') })}
          />
        ) : null}
      </div>
    </Frame>
  );
}

/** A tenth of a degree either way is the sensor and not the leaf. */
const offsetKey = (offset: number): string =>
  Math.abs(offset) < 0.1 ? 'cockpit.leaf.same' : offset < 0 ? 'cockpit.leaf.cooler' : 'cockpit.leaf.warmer';
