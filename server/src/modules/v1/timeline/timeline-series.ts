import type {
  CameraStill,
  DeviceLive,
  DeviceSeries,
  GrowthStage,
  Metric,
  OutputMetric,
  PhaseTargets,
  SeriesPoint,
  SpaceTimeline,
  TimelineOutputLane,
  TimelinePanel,
  TimelineReading,
  TimelineSpan,
  TimelineTarget,
  TimelineTargets,
} from '@fg2/shared-types/v1';
import { DAY_ONLY, METRIC_DECIMALS, VALUE_AGE } from '@fg2/shared-types/v1-schemas';
import { leastSilence, quietLimits, SILENT_AFTER } from '@fg2/shared-types/v1-schemas/cadence.js';
import { cycleKindOf, nightsIn, transitionsIn, type Cycle, type Span } from '@fg2/shared-types/v1-schemas/day-night.js';
import { OUTPUT_LEVEL } from '@common/v1/metrics';
import type { CameraDocument } from '@database/schemas/v1/cameras.schema';
import type { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import type { DeviceHistory, OutputHistory } from '@modules/data/data.service';
import type { OutputSwitching } from '@modules/data/flux';
import { bandAround, halvesHeld, recordedBandAt, unionOf, type RecordedClimate } from '../device/held-targets';
import { cyclesOf, type CycleStretch } from '../phase/target-record';

/**
 * What the windows of a read mean once they are on the screen: the stacked
 * panels, the band that applied across each of them, the night, and the lanes
 * under them.
 *
 * Nothing here reaches for a database, so what the timeline says about a read
 * can be read - and tested - as arithmetic. What comes in is what one read per
 * controller answered: the curve, window by window, and the switchings of the
 * outputs, which are instants rather than windows because a state is not a
 * measurement and averaging one loses the very thing a lane is about.
 */

/**
 * The panels a caller that names none is answered, in the order they stack:
 * the three a controller steers, then the leaf and the light a canopy sensor
 * measures. VPD and PPFD are computed, cost the lamp's switchings to tell a
 * leaf by day from one at night, and are answered to whoever asks for them -
 * the Timeline's page does.
 */
export const PANEL_METRICS: readonly Metric[] = ['temperature', 'humidity', 'co2', 'leafTemperature', 'lux'];

/** One stretch of the window over which the same targets applied, before it is stated per metric. */
export interface TargetStretch {
  startsAt: Date;
  endsAt: Date;
  /** The phase of the grow the stretch falls in; null where no grow stood here. */
  phaseId: string | null;
  stage: GrowthStage | null;
  targets: PhaseTargets | null;
  /** The cycle the steering device ran over it - its work mode and light schedule - where the record says; read as a schedule where it does not. */
  cycle?: Cycle | null;
  /** In the hour after a change: the climate that stood just before it, which the bands reach over too. */
  settling?: RecordedClimate | null;
}

/**
 * The panels, each with the bands that applied across it.
 *
 * A metric with no reading in the window has no panel rather than a panel of
 * nulls: a tent without a CO2 sensor reports no CO2, and a fridge has no leaf
 * sensor, and that is what makes those panels appear only where there is
 * something to draw in them. The leaf and the light are never steered, so
 * theirs carry no band.
 *
 * Which metrics are stacked is the timeline's own unless a caller says
 * otherwise, and there is no second way of turning points into a panel.
 *
 * A panel is one device's readings: the place's own climate, or the one a
 * reader asked for (`ownOf`). Two devices in one place are two thermometers
 * and often two climates - a tent's controller and a fridge module - and a
 * mean of them is a figure neither read, which no other screen states.
 *
 * It is handed the device's whole read and not its series alone: the samples
 * each window held and the edges of its pauses are what a silence in its
 * curve is measured by, as in its lanes and its nights. Handed the series, the
 * curve of a slow device broke at every empty window under lanes that ran
 * whole - the route did so for a pass, while its tests passed the counts by hand.
 */
export const panelsOf = (
  history: Pick<DeviceHistory, 'series' | 'samples' | 'edges'> | null,
  stretches: readonly TargetStretch[],
  metrics: readonly Metric[] = PANEL_METRICS,
): TimelinePanel[] =>
  metrics.flatMap(metric => {
    const points = history ? heardOf(history.series, metric, history) : [];

    return points.some(point => point.value !== null) ? [{ metric, points, targets: targetsOf(metric, stretches) }] : [];
  });

/**
 * The band and the dashed line of one metric, one row per stretch that holds a
 * target for it at all - in the mode the device ran then. Drying holds the
 * night's temperature and humidity round the clock, germination the night's
 * temperature alone, the greenhouse mode no humidity, and a device switched off
 * nothing; 24 hours of light hold the day's figures and none the night's. Such a
 * stretch says so (`held`), and its one band is drawn through the whole of it.
 *
 * In the hour after a change each band reaches over what held just before it
 * (`settling`), as the verdict judges it.
 */
export const targetsOf = (metric: Metric, stretches: readonly TargetStretch[]): TimelineTargets[] => joinedRows(rowsOf(metric, stretches));

/**
 * Neighbours that say the same about this metric are one row: a stretch cut
 * where the record moved something else - the light schedule, the other
 * metric - or where it confirmed what a phase took down draws no seam in a
 * band that did not move. A row that does not say how its targets were held is
 * read as a schedule's, as a client reads it.
 */
const joinedRows = (rows: readonly TimelineTargets[]): TimelineTargets[] =>
  rows.reduce<TimelineTargets[]>((kept, row) => {
    const last = kept.at(-1);
    const said = (one: TimelineTargets) =>
      JSON.stringify([one.phaseId, one.stage, one.day, one.night, one.held ?? 'schedule', one.settling ?? false]);
    if (last && last.endsAt === row.startsAt && said(last) === said(row)) {
      return [...kept.slice(0, -1), { ...last, endsAt: row.endsAt, ...((last.held ?? row.held) ? { held: last.held ?? row.held } : {}) }];
    }
    return [...kept, row];
  }, []);

const rowsOf = (metric: Metric, stretches: readonly TargetStretch[]): TimelineTargets[] =>
  stretches.flatMap(stretch => {
    const kind = stretch.cycle ? cycleKindOf(stretch.cycle) : null;
    if (kind === 'off') return [];
    const halves = halvesHeld(stretch.targets, stretch.cycle?.workmode ?? null);
    let day = kind === 'always_night' ? null : halfOf(metric, halves.day[metric] ?? null);
    let night = kind === 'always_day' || DAY_ONLY.includes(metric) ? null : halfOf(metric, halves.night[metric] ?? null);
    if (day === null && night === null) return [];

    let settling = false;
    if (stretch.settling) {
      const before = recordedBandAt(stretch.settling, metric, stretch.settling.at - 1, 'day');
      const widen = (own: TimelineTarget | null): TimelineTarget | null => {
        const band = own && unionOf([own.band, before]);
        return own && band ? { setpoint: own.setpoint, band: { low: rounded(band.low, metric), high: rounded(band.high, metric) } } : null;
      };
      const [wideDay, wideNight] = [widen(day), widen(night)];
      settling = JSON.stringify([wideDay, wideNight]) !== JSON.stringify([day, night]);
      if (settling) [day, night] = [wideDay, wideNight];
    }

    return [
      {
        startsAt: stretch.startsAt.toISOString(),
        endsAt: stretch.endsAt.toISOString(),
        phaseId: stretch.phaseId,
        stage: stretch.stage,
        day,
        night,
        ...(kind ? { held: kind } : {}),
        ...(settling ? { settling: true } : {}),
      },
    ];
  });

/**
 * When the night's figures held, which is what the panels are shaded by: the
 * cycle of the device the place is steered by, as its record has it
 * (`cyclesOf`) - its light schedule and its work mode, which is what the device
 * itself goes by. A lamp held off at noon, or set to 0 %, is a dark day and
 * not a night, and a drying room is one long night.
 *
 * Where the record says nothing - before it began, or before it recorded
 * cycles - the night is read off the lamp, as it always was. Either way a
 * night is shaded only through hours a device reported in.
 */
export const nightsOf = (histories: readonly DeviceHistory[], window: SeriesWindow, cycles: readonly CycleStretch[] = []): TimelineSpan[] => {
  if (!cycles.some(stretch => stretch.cycle)) return lampNightsOf(histories, window);

  const lamp = cycles.some(stretch => !stretch.cycle) ? lampNightsOf(histories, window).map(spanOf) : [];
  // A schedule knows nothing of a silence: its nights are shaded only where somebody reported through them, as
  // the lamp's are - not across a morning the device was gone for, nor on to the window's end after its last word.
  const heard = histories.flatMap(one => heardStretches(heardIn(one.series), readOf(one.series, window), one.series.stepSeconds, heardAt(one)));
  return asTimelineSpans(
    cycles.flatMap(stretch =>
      stretch.cycle
        ? overlapping(nightsIn(stretch.cycle, stretch), heard)
        : lamp.flatMap(span => {
            const from = Math.max(span.from, stretch.from);
            const to = Math.min(span.to, stretch.to);
            return to > from ? [{ from, to }] : [];
          }),
    ),
  );
};

/**
 * When the steering device was changing between its halves and the climate was
 * given time to follow (`transitionsIn`), where the record says what its cycle
 * was.
 */
export const transitionsOf = (cycles: readonly CycleStretch[]): TimelineSpan[] =>
  asTimelineSpans(cycles.flatMap(stretch => (stretch.cycle ? transitionsIn(stretch.cycle, stretch) : [])));

const spanOf = (span: TimelineSpan): Span => ({ from: millis(span.startsAt), to: millis(span.endsAt) });

/** In order, with touching stretches as one. */
const asTimelineSpans = (spans: readonly Span[]): TimelineSpan[] =>
  [...spans]
    .filter(span => span.to > span.from)
    .sort((one, other) => one.from - other.from)
    .reduce<Span[]>((kept, span) => {
      const last = kept.at(-1);
      if (last && span.from <= last.to) kept[kept.length - 1] = { from: last.from, to: Math.max(last.to, span.to) };
      else kept.push(span);
      return kept;
    }, [])
    .map(span => ({ startsAt: new Date(span.from).toISOString(), endsAt: new Date(span.to).toISOString() }));

/**
 * When the light was off. The controllers of one tent switch one lamp, so the
 * first that reports the output answers for the space rather than two of them
 * shading it twice.
 */
const lampNightsOf = (histories: readonly DeviceHistory[], window: SeriesWindow): TimelineSpan[] => {
  // Each device is read over its own stay, so a lamp is too: the nights before a change of the measuring device
  // are those the device before it reported, and no two of them speak for the same hour.
  const lit = histories.filter(one => outputIn(one, 'light').switchings.length > 0);
  if (lit.length > 0) {
    return asTimelineSpans(lit.flatMap(one => spansOf(outputIn(one, 'light'), false, one.series, stayOf(one, window), heardAt(one)).map(spanOf)));
  }

  // A place with no lamp at all - an AIR fan on its own - is shaded by the night the fan says it runs,
  // as far as its own output was heard. The old charts drew that as a line of its own.
  const fan = histories.find(one => (one.days ?? []).length > 0 && one.series.outputs.some(output => output.output === 'fan'));

  return fan ? spansOf({ output: 'fan', switchings: fan.days ?? [] }, false, fan.series, window, heardAt(fan)) : [];
};

/**
 * One lane per output a device reported, as the stretches it ran for. A device
 * that said nothing about an output has no lane.
 *
 * A redacted reader - a link, a public page - is told which output ran and
 * when, and not which controller drove it: the answer beside these lanes
 * already withholds the ids of the hardware in the tent, and a lane naming it
 * handed each one back.
 *
 * Each lane also says how far anything is known about it. A run that stops
 * because the device stopped reporting looks exactly like one that stops
 * because the output was switched off, and a client drawing a square wave has
 * to be able to tell them apart: three days of silence are not three days of
 * "off".
 *
 * Where the read counted the outputs' samples, a lane carries them point by
 * drawn point (`pointsOfOutput`): what a card, a share of the time and a strip
 * say about an output is counted from those, and the spans say only when.
 * A lane of a fridge module says so, because its dehumidifier output is the
 * compressor and every screen calls it that - a link included.
 */
export const lanesOf = (
  histories: readonly DeviceHistory[],
  window: SeriesWindow,
  redacted = false,
  fridges: ReadonlySet<string> = new Set(),
): TimelineOutputLane[] =>
  histories.flatMap(one =>
    one.outputs.flatMap(output =>
      output.switchings.length > 0
        ? [
            {
              output: output.output,
              deviceId: redacted ? null : one.series.deviceId,
              ...(fridges.has(one.series.deviceId) ? { fridge: true as const } : {}),
              ...laneOf(output, one.series, window, heardAt(one)),
            },
          ]
        : [],
    ),
  );

/**
 * What every chart of a place carries around its curves - the Timeline, a
 * place's charts and a grow's - read off the same histories the same way, so
 * that the three screens cannot disagree about a night, a lane or a camera.
 */
export const chartPartsOf = (read: {
  histories: readonly DeviceHistory[];
  devices: readonly { id: string; type: string }[];
  window: SeriesWindow & { stepSeconds: number };
  redacted: boolean;
  /** The steering device's target record over the window, which the night and the transitions are read from. */
  aimed: readonly StoredTargetChange[];
  cameras: readonly Pick<CameraDocument, 'id' | 'name'>[];
  frames: ReadonlyMap<string, CameraStill[]>;
}): Pick<SpaceTimeline, 'stepSeconds' | 'deviceIds' | 'outputs' | 'nights' | 'transitions' | 'cameras'> => {
  const cycles = cyclesOf(read.aimed, read.window);

  return {
    stepSeconds: read.histories.length === 0 ? 0 : read.window.stepSeconds,
    deviceIds: read.redacted ? null : read.devices.map(device => device.id),
    outputs: lanesOf(read.histories, read.window, read.redacted, fridgesOf(read.devices)),
    nights: nightsOf(read.histories, read.window, cycles),
    transitions: transitionsOf(cycles),
    cameras: read.cameras.map(camera => ({ cameraId: camera.id, name: camera.name, frames: read.frames.get(camera.id) ?? [] })),
  };
};

/**
 * A device's last reading as the Timeline answers it: the metrics asked for, the instant of the newest of
 * them, and each output it said then as on or off with its level in per cent where it has one (`OUTPUT_LEVEL`).
 */
export const readingOf = (live: Pick<DeviceLive, 'metrics' | 'outputs'>, metrics: readonly Metric[]): TimelineReading | null => {
  const values = metrics.flatMap(metric => {
    const one = live.metrics[metric];
    return one && one.value !== null && one.measuredAt !== null ? [{ metric, ...one }] : [];
  });
  const outputs = (Object.entries(live.outputs) as [OutputMetric, DeviceLive['outputs'][OutputMetric]][]).flatMap(([output, one]) =>
    one && one.value !== null && one.measuredAt !== null ? [{ output, value: one.value, measuredAt: one.measuredAt }] : [],
  );
  // A place of outputs alone - a socket, a fan - has a reading too: what its outputs last said, and when.
  const heard = (values.length > 0 ? values : outputs).map(one => one.measuredAt as string);
  if (heard.length === 0) return null;
  const measuredAt = heard.reduce((newest, one) => (one > newest ? one : newest));

  return {
    measuredAt,
    values,
    // An output last heard of before this reading - longer before it than a reading stays fresh - is no part of it:
    // a valve that stopped being reported last week is not "aus" now.
    outputs: outputs.flatMap(({ output, value, measuredAt: saidAt }) => {
      if (millis(measuredAt) - millis(saidAt) > VALUE_AGE.liveSeconds * 1000) return [];
      const kind = OUTPUT_LEVEL[output];
      return [{ output, on: value > 0, level: kind?.unit === 'percent' ? Math.round(Math.min(100, value * kind.scale)) : null }];
    }),
  };
};

/** The devices of a read that are fridge modules, which is what names a lane's compressor. */
const fridgesOf = (devices: readonly { id: string; type: string }[]): ReadonlySet<string> =>
  new Set(devices.filter(device => device.type === 'fridge').map(device => device.id));

/**
 * One output's drawn points, where the read counted its samples: how many each window held, in how many the
 * output ran, and for one driven at a level the mean level over all of them in per cent of full output.
 */
const pointsOfOutput = (output: OutputHistory): Pick<TimelineOutputLane, 'points'> => {
  if (!output.figures) return {};
  const kind = OUTPUT_LEVEL[output.output];

  return {
    points: output.figures.map(figure => ({
      measuredAt: figure.measuredAt,
      heard: figure.heard,
      on: figure.on,
      // To a tenth: a heater that ran at 59 % in one sample of six is 9,8 % of full output over that window.
      level: kind?.unit === 'percent' ? Math.round(Math.min(100, figure.mean * kind.scale) * 10) / 10 : null,
    })),
  };
};

/**
 * One output's lane: the stretches it ran for, how far anything is known of it - the window's own end while its
 * device is still reporting -, and its drawn points. A point says where the device had fallen silent before it
 * (`resumed`), which is the one verdict a screen draws the strip by: it works out no silence of its own.
 */
const laneOf = (
  output: OutputHistory,
  series: DeviceSeries,
  window: SeriesWindow,
  sampled: Sampled,
): Pick<TimelineOutputLane, 'spans' | 'heardUntil' | 'points'> => {
  const read = readOf(series, window);
  const heard = heardStretches(series.outputs.find(one => one.output === output.output)?.points ?? [], read, series.stepSeconds, sampled);
  const drawn = pointsOfOutput(output).points;

  return {
    spans: overlapping(stateStretches(output.switchings, true), heard).map(asSpan),
    heardUntil: new Date(heard.at(-1)?.to ?? window.startsAt.getTime()).toISOString(),
    ...(drawn
      ? {
          points: drawn.map((point, index) => {
            const [before, stamp] = [index === 0 ? Number.NEGATIVE_INFINITY : millis(drawn[index - 1].measuredAt), millis(point.measuredAt)];
            // The stretch that begins in this window - or in one before it that has no point - began after a silence,
            // unless it is the read's first and was heard that close to where the read begins.
            const began = heard.some(one => one.first > before && one.first <= stamp && one.from > read.startsAt.getTime());
            return began ? { ...point, resumed: true } : point;
          }),
        }
      : {}),
  };
};

/**
 * The stretches of its read a device said nothing in, by the interval it was keeping: what stands between the
 * stretches it was heard over, of any of its fields, and before the first and after the last of them.
 */
export const silencesOf = (history: DeviceHistory | null, window: SeriesWindow): TimelineSpan[] => {
  if (!history) return [];
  const read = readOf(history.series, window);
  const heard = heardStretches(heardIn(history.series), read, history.series.stepSeconds, heardAt(history));
  const edges = [read.startsAt.getTime(), ...heard.flatMap(one => [one.from, one.to]), read.endsAt.getTime()];

  return heard.length === 0
    ? []
    : edges.flatMap((from, index) => (index % 2 === 0 && edges[index + 1] > from ? [asSpan({ from, to: edges[index + 1] })] : []));
};

/** The windows a device was heard in, of whichever of its fields: a device is heard when any of them reports. */
const heardIn = (series: DeviceSeries): SeriesPoint[] => {
  const stamps = new Set(
    [...series.metrics, ...series.outputs].flatMap(row => row.points.flatMap(point => (point.value === null ? [] : [point.measuredAt]))),
  );
  return [...stamps].sort().map(measuredAt => ({ measuredAt, value: 0 }));
};

const asSpan = (stretch: Stretch): TimelineSpan => ({ startsAt: new Date(stretch.from).toISOString(), endsAt: new Date(stretch.to).toISOString() });

/** The part of the window a device's read covers: its stay. */
const stayOf = (history: DeviceHistory, window: SeriesWindow): SeriesWindow => ({
  startsAt: new Date(Math.max(window.startsAt.getTime(), millis(history.series.startsAt))),
  endsAt: new Date(Math.min(window.endsAt.getTime(), millis(history.series.endsAt))),
});

/** What a read says of a device's samples: its newest inside the window, the first and last of a window beside a silence, how many each window held. */
interface Sampled {
  newest: number | null;
  edges?: DeviceHistory['edges'];
  samples?: DeviceHistory['samples'];
}

/** When the device last wrote anything inside this window, as an instant the arithmetic can use, or nothing where the read could not say. */
const heardAt = (history: DeviceHistory): Sampled => ({
  newest: history.lastSampleAt === null ? null : millis(history.lastSampleAt),
  edges: history.edges,
  samples: history.samples,
});

/** What one device said about one output, or nothing where it was not asked about it or never reported it. */
const outputIn = (history: DeviceHistory, output: OutputMetric): OutputHistory =>
  history.outputs.find(one => one.output === output) ?? { output, switchings: [] };

/** The window the lanes and the night are read against. */
interface SeriesWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The part of the window one device was read over. A device is read over its
 * stay in the place, so that is where its edges are: a device that came an
 * hour ago ran nothing here before it came, however wide the window its first
 * point stands for, and one that has left is not "still reporting" by the
 * window's end.
 */
const readOf = (series: DeviceSeries, window: SeriesWindow): SeriesWindow => ({
  startsAt: new Date(Math.max(window.startsAt.getTime(), millis(series.startsAt))),
  endsAt: new Date(Math.min(window.endsAt.getTime(), millis(series.endsAt))),
});

/**
 * Where a row of heard windows breaks: how long the device may say nothing at each place in it (`quietLimits`,
 * by the interval it was keeping there, which its samples per window say where the read counted them), and
 * before which window it had said nothing for longer. A gap is measured by its samples where the read asked the
 * store for them - the last before it and the first after it - and by the windows' stamps where it did not: a
 * pause of an hour is then one verdict at every step, and not a line where it fell into three windows and a
 * silence where it fell into four.
 */
const breaksOf = (heard: readonly number[], stepSeconds: number, { samples, edges }: Pick<Sampled, 'samples' | 'edges'>) => {
  const limits = quietLimits(
    heard,
    stepSeconds * 1000,
    heard.map(stamp => samples?.get(stamp)),
  );
  const silent = heard.map((stamp, index) => {
    const before = heard[index - 1];
    return index > 0 && (edges?.get(stamp)?.first ?? stamp) - (edges?.get(before)?.last ?? before) > limits[index];
  });
  return { limits, silent };
};

/**
 * The stretches of the window one output held a state for.
 *
 * Two things decide a span, and they are two different facts. The switchings
 * say what the output was doing - they are the instants the store found it
 * changing, so a span is as long as the output really ran and not as long as
 * the windows the curve happens to be drawn with. What was heard says how far
 * that may be carried: nothing is known about the lamp while nobody was
 * reporting, so a run is cut where the device was last heard and picked up
 * where it came back, which is the same break the curve above it draws rather
 * than a lane running straight through the hole in the line.
 *
 * A run still going where the device was last heard therefore ends there and
 * not at the edge of the window - a device that has said nothing for three days
 * is not three days of "off".
 */
const spansOf = (output: OutputHistory, on: boolean, series: DeviceSeries, window: SeriesWindow, sampled: Sampled): TimelineSpan[] => {
  const points = series.outputs.find(one => one.output === output.output)?.points ?? [];

  return overlapping(stateStretches(output.switchings, on), heardStretches(points, readOf(series, window), series.stepSeconds, sampled)).map(asSpan);
};

/** A stretch of the window in instants, before it is written as a span. */
interface Stretch {
  from: number;
  to: number;
}

/** A stretch a device was heard over, with the stamp of the first window it was heard in. */
interface Heard extends Stretch {
  first: number;
}

/**
 * The stretches the state was the one asked about. The last switching runs on
 * for ever, because nothing after it says otherwise; how far it is actually
 * drawn is decided by what was heard.
 */
const stateStretches = (switchings: readonly OutputSwitching[], on: boolean): Stretch[] =>
  switchings.flatMap((switching, index) => {
    if (switching.on !== on) return [];
    const next = switchings[index + 1];

    // The first row is the state the window was found in, stamped with the first grain a sample fell into - up
    // to a grain after the window began. The state held before it too: a night does not begin two seconds in.
    return [{ from: index === 0 ? Number.NEGATIVE_INFINITY : millis(switching.at), to: next ? millis(next.at) : Number.POSITIVE_INFINITY }];
  });

/**
 * The stretches the device was reporting across, which is all anything can be
 * known about.
 *
 * A device that was already reporting when the window opened was running before
 * it, so the first stretch is drawn from the edge rather than from its first
 * sample; one that only turned up later is drawn from where it turned up, and
 * the same rule closes the far end.
 *
 * A stretch begins with the window its first point stands for. The store
 * stamps an aggregation window at its stop instant, so a point at t is what
 * was heard over the step before t: a device back at 16:00 after a silence has
 * its first point of three minutes at 16:03, and a lamp lit since it came back
 * was lit from 16:00. A burst that lands in a single window would otherwise be
 * a stretch from an instant to the same instant, which nothing can overlap. It
 * is widened backwards and never forwards, because forwards is past the last
 * thing the device said - and past the end of the window, where the window
 * closes on a grow that has ended.
 *
 * The same stamping is why the far end is cut to the newest sample the device
 * really wrote. The last point of a series stands for a window that ends up to
 * a step after the sample inside it, and drawing to that stamp was drawing an
 * hour of lamp state for a stretch nothing was heard across - at a season's
 * step it would be most of half a day. A device that is still reporting keeps
 * the edge it already had: the closing stretch is snapped to the end of the
 * window, so a live tent has no gap at the right-hand edge of its own chart.
 */
const heardStretches = (
  points: readonly SeriesPoint[],
  window: SeriesWindow,
  stepSeconds: number,
  { newest: sampled, edges, samples }: Sampled,
): Heard[] => {
  const heard = points.flatMap(point => (point.value === null ? [] : [millis(point.measuredAt)]));
  if (heard.length === 0) return [];

  const { limits, silent } = breaksOf(heard, stepSeconds, { samples, edges });
  const stretches: Heard[] = [];
  heard.forEach((at, index) => {
    if (index === 0 || silent[index]) stretches.push({ from: at, to: at, first: at });
    else stretches[stretches.length - 1].to = at;
  });
  const silence = limits[heard.length];

  for (const [index, stretch] of stretches.entries()) {
    const after = index === 0 ? window.startsAt.getTime() : stretches[index - 1].to + 1;
    // Where the read says when the samples of a window were written, a stretch begins with the first of its first
    // window and ends with the last of its last: at one instant, however wide the windows are.
    const [first, last] = [edges?.get(stretch.from)?.first, edges?.get(stretch.to)?.last];
    stretch.from = Math.max(first ?? stretch.from - stepSeconds * 1000, after, window.startsAt.getTime());
    stretch.to = Math.max(stretch.from, last ?? stretch.to);
  }

  const opens = stretches[0];
  const closes = stretches[stretches.length - 1];
  if (sampled !== null) closes.to = Math.max(closes.from, Math.min(closes.to, sampled));
  if (opens.from - window.startsAt.getTime() <= limits[0]) opens.from = window.startsAt.getTime();
  // A device whose newest sample is known is still reporting by the rule the rest of the app goes by, not by
  // the rhythm of a window as wide as a month's: a lamp is not "on" for the hours after its device went quiet.
  // One that reports slowly - its limit is its own, above the step's - is still reporting within that limit.
  const slow = silence > leastSilence(stepSeconds * 1000);
  if (window.endsAt.getTime() - closes.to <= (sampled === null || slow ? silence : Math.min(silence, VALUE_AGE.staleSeconds * 1000))) {
    closes.to = window.endsAt.getTime();
  }

  return stretches;
};

/** Where two lists of stretches are both true, in order. Neither list overlaps itself, so the answer does not either. */
const overlapping = (one: readonly Stretch[], other: readonly Stretch[]): Stretch[] =>
  one
    .flatMap(mine =>
      other.flatMap(theirs => {
        const from = Math.max(mine.from, theirs.from);
        const to = Math.min(mine.to, theirs.to);

        return to > from ? [{ from, to }] : [];
      }),
    )
    .sort((mine, theirs) => mine.from - theirs.from);

const millis = (instant: string): number => new Date(instant).getTime();

/**
 * One metric of one device, window by window.
 *
 * Only the windows something was read in are answered, with a break written
 * between two of them the device fell silent across, and one after the last of
 * them where it has been silent since. A window with no reading is not a
 * hole in the measurement: a device sampling every hour into windows of three
 * minutes leaves nineteen empty ones between every sample, and a series of
 * holes with a lone reading between them is a line that cannot be drawn at all.
 * What the curve has to break at is the silence, which is the same thing the
 * lanes under it break at.
 */
const heardOf = (series: DeviceSeries, metric: Metric, sampled: Pick<Sampled, 'samples' | 'edges'>): SeriesPoint[] => {
  const heard = (series.metrics.find(row => row.metric === metric)?.points ?? []).flatMap(point =>
    point.value === null
      ? []
      : [
          {
            measuredAt: point.measuredAt,
            value: rounded(point.value, metric),
            ...(point.min !== undefined && point.max !== undefined ? { min: rounded(point.min, metric), max: rounded(point.max, metric) } : {}),
          },
        ],
  );

  const { limits, silent } = breaksOf(
    heard.map(point => millis(point.measuredAt)),
    series.stepSeconds,
    sampled,
  );
  // The end is held to one of the device's intervals there, and to a step: see `closed`.
  const atEnd = Math.max(VALUE_AGE.staleSeconds * 1000, series.stepSeconds * 1000, limits[heard.length] / SILENT_AFTER);
  return closed(broken(heard, silent), millis(series.endsAt), atEnd);
};

/** The readings with a null between the two the space went quiet between, which is where the line stops and starts again. */
const broken = (points: readonly SeriesPoint[], silent: readonly boolean[]): SeriesPoint[] =>
  points.flatMap((point, index) => {
    const before = points[index - 1];
    if (!before || !silent[index]) return [point];

    // The break belongs at the instant after the last thing anybody said, not
    // halfway across the silence, which would claim a reading was due there.
    return [{ measuredAt: new Date(millis(before.measuredAt) + 1).toISOString(), value: null }, point];
  });

/**
 * The same break after the last reading, where the window runs on past it.
 *
 * The end is held to one usual gap rather than four. A window is stamped where
 * it closes, so a device reporting now has its last point on the window's own
 * end, and one that stopped has it at most a window after its last sample.
 * Four of a month's hour-and-a-half windows let a fridge that went offline in
 * the morning print its morning figures under the afternoon's clock, on a
 * screen whose pill already said offline. Never less than the ten minutes after
 * which the rest of the app calls a device offline, and never less than the
 * rhythm the device keeps, so an hourly history is not cut an hour short.
 *
 * A silence at the end of a window is the one nobody closed, and it is the one
 * a reader is most likely to be looking at: both screens read a line at the
 * cursor as the last point at or before it, so a tent that fell quiet on
 * Saturday went on printing Saturday's figures under Wednesday's clock,
 * undimmed and undated. Closing it here says the same thing an interior gap
 * already says - nothing was measured here - and says it on the Charts header,
 * the Timeline header and the cursor's dot at once.
 */
const closed = (points: readonly SeriesPoint[], endsAt: number, silence: number): SeriesPoint[] => {
  const last = points[points.length - 1];
  if (!last || last.value === null || endsAt - millis(last.measuredAt) <= silence) return [...points];

  return [...points, { measuredAt: new Date(millis(last.measuredAt) + 1).toISOString(), value: null }];
};

const halfOf = (metric: Metric, setpoint: number | null): TimelineTarget | null => {
  const band = bandAround(metric, setpoint ?? undefined);
  return setpoint === null || band === null ? null : { setpoint, band: { low: rounded(band.low, metric), high: rounded(band.high, metric) } };
};

/** What the sensor can say, and no more: the mean of two readings is otherwise seventeen digits of which one is a measurement. */
export const rounded = (value: number, metric: Metric): number => {
  const factor = 10 ** METRIC_DECIMALS[metric];

  return Math.round(value * factor) / factor;
};
