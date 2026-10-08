import { CalendarRange, Moon, Sun } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { utcSecondsOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { Help } from '@/ui/Help';
import { halfOf, phaseOf, rampsFor, rampsOf, type Field, type Half, type NowHolding, type Ramps, type Shape } from './day-night';
import { scheduleTitle, windowWords } from './schedule-words';
import { ClockStepper, Stepper } from './Stepper';
import type { LightSchedule, TargetsDraft } from './targets-draft';
import styles from './DayNight.module.css';

export interface LightPlanProps {
  device: Device;
  /** The shape of the draft, which is what is edited. */
  shape: Shape;
  /** The shape of what the device runs, which is what "now" is about. */
  storedShape: Shape;
  draft: TargetsDraft;
  /** What the device runs: the stored document. */
  baseline: TargetsDraft;
  set: (next: TargetsDraft) => void;
  readOnly: boolean;
  now: DateTime;
  /** How far the account's wall clock is ahead of UTC, in seconds. */
  offset: number;
  holding: NowHolding;
  /** "Offline seit 10:19", for a device not heard from. */
  offline: string | null;
  /** The figures a running plan writes back every hour. */
  owned: ReadonlySet<Field>;
  /** The light schedule a running plan puts back within the hour, where it is not the one that runs. */
  planSets?: { name: string; schedule: LightSchedule } | null;
}

/**
 * The light plan, over the table it decides between: what it is in one line,
 * the day it makes drawn from midnight to midnight with the ramps and now
 * marked, one line on what holds at this moment and until when, and the two
 * figures it is set by - when the light comes on, and for how long. The night
 * is not set anywhere: it is what the day leaves, and is said as such.
 *
 * Everything that says "now" is about what the device runs. A schedule being
 * edited is drawn beside it as a draft, and where saving it would turn the day
 * into night on the spot - or light the lamp in the middle of one - that is
 * said before the save rather than found out after it.
 *
 * Drying and germination have no light to plan: the lamp stays off round the
 * clock, which is what the block says, with the plan that comes back after.
 */
export function LightPlan(props: LightPlanProps) {
  const { device, shape, baseline, offset } = props;
  const { t } = useTranslation();
  const regime = shape.regime;

  if (regime === 'off') return null;

  if (regime === 'drying' || regime === 'germination') {
    return (
      <div className={styles.section} aria-label={t('targets.plan.label')} role="group">
        <p className={styles.planTitle} data-dark>
          <Moon size={16} strokeWidth={2} aria-hidden />
          <span>{t(`targets.plan.${regime}`)}</span>
        </p>
        <p className={styles.note}>{t(`targets.plan.${regime}Line`, { window: scheduleTitle(t, baseline, offset) })}</p>
      </div>
    );
  }

  if (regime === 'sensor') {
    return (
      <div className={styles.section} aria-label={t('targets.plan.label')} role="group">
        <p className={styles.planTitle}>
          <Sun size={16} strokeWidth={2} aria-hidden />
          <span>{t('targets.plan.sensor')}</span>
        </p>
        <NowLine {...props} />
      </div>
    );
  }

  return <Schedule {...props} key={device.id} />;
}

function Schedule(props: LightPlanProps) {
  const { device, draft, baseline, set, readOnly, now, offset, owned, planSets = null } = props;
  const { t } = useTranslation();
  const changed = draft.lightsOn !== baseline.lightsOn || draft.lightHours !== baseline.lightHours;
  const words = windowWords(draft, offset);
  const ramps = rampsFor(device, device.configuration, baseline);
  // A lamp at 0 % keeps its day without light: the plan is the day's then, and says so where it is read first.
  const dark = draft.lightLimit <= 0 && !words.never;
  const title = dark
    ? t(words.always ? 'targets.plan.alwaysDark' : 'targets.plan.windowDark', { on: words.on, off: words.off, hours: words.hours })
    : scheduleTitle(t, draft, offset);
  // A tent controller's firmware loses the morning ramp of a window that runs
  // past midnight UTC: its lamp comes on at once, as the bar draws it.
  const hardStart = rampsOf(device.configuration).up > 0 && rampsFor(device, device.configuration, draft).up === 0 && !words.always && !words.never;
  const mark = (field: Field) =>
    owned.has(field) ? (
      <CalendarRange size={13} strokeWidth={2} className={styles.planMark} role="img" aria-label={t('targets.table.planMark')} />
    ) : null;

  return (
    <div className={styles.section} role="group" aria-label={t('targets.plan.label')}>
      <p className={styles.planTitle} data-changed={changed || undefined} data-dark={words.never || undefined}>
        {words.never ? <Moon size={16} strokeWidth={2} aria-hidden /> : <Sun size={16} strokeWidth={2} aria-hidden />}
        <span className={styles.planWindow}>
          {title}
          <Help topic="dayNight" />
        </span>
        {changed ? <span className={styles.draftTag}>{t('targets.plan.draft')}</span> : null}
      </p>
      {changed ? <p className={`mono ${styles.was}`}>{t('targets.plan.was', { window: scheduleTitle(t, baseline, offset) })}</p> : null}

      <Bar
        schedule={baseline}
        draft={changed ? draft : null}
        ramps={ramps}
        dim={baseline.lightLimit <= 0}
        offset={offset}
        nowMinutes={minutesOf(utcSecondsOf(now.toMillis()) + offset)}
        label={scheduleTitle(t, baseline, offset)}
        draftLabel={t('targets.plan.draftBarAlt', { window: scheduleTitle(t, draft, offset) })}
      />

      <NowLine {...props} />
      <Flip {...props} changed={changed} />
      {dark ? <p className={`${styles.note} ${styles.warn}`}>{t('targets.table.zeroLimit')}</p> : null}
      {/* A step that names its own hours or its own time puts them back within the hour, whatever runs now. */}
      {planSets ? (
        <p className={`${styles.note} ${styles.warn}`}>
          {t('targets.plan.planSets', { name: planSets.name, window: scheduleTitle(t, planSets.schedule, offset) })}
        </p>
      ) : null}

      <div className={styles.fields}>
        {/* Light round the clock, or none, has no time it comes on: the hour is
            kept for the day a photoperiod is set again, and said under the plan. */}
        {words.always || words.never ? null : (
          <div className={styles.field} data-keep>
            <span className={styles.fieldLabel}>
              {t('targets.plan.lightsOn')}
              {mark('lightsOn')}
              <Help topic="lightsOn" />
            </span>
            <ClockStepper
              name={t('targets.aria.lightsOn')}
              seconds={draft.lightsOn}
              offset={offset}
              less={t('targets.plan.earlier', { name: t('targets.aria.lightsOn') })}
              more={t('targets.plan.later', { name: t('targets.aria.lightsOn') })}
              changed={draft.lightsOn !== baseline.lightsOn}
              disabled={readOnly}
              onChange={lightsOn => set({ ...draft, lightsOn })}
            />
          </div>
        )}
        <div className={styles.field} data-keep>
          <span className={styles.fieldLabel}>
            {t('targets.plan.hours')}
            {mark('lightHours')}
          </span>
          <Stepper
            name={t('targets.aria.lightHours')}
            value={draft.lightHours}
            min={0}
            max={24}
            step={1}
            decimals={1}
            unit={t('targets.unit.hours')}
            less={t('targets.stepLess', { name: t('targets.aria.lightHours') })}
            more={t('targets.stepMore', { name: t('targets.aria.lightHours') })}
            changed={draft.lightHours !== baseline.lightHours}
            disabled={readOnly}
            onChange={lightHours => set({ ...draft, lightHours })}
          />
        </div>
      </div>

      {words.always ? (
        <p className={styles.note}>
          {t('targets.plan.alwaysLine')} {t('targets.plan.keepsHour', { time: words.on })}
        </p>
      ) : words.never ? (
        <p className={styles.note}>
          {t('targets.plan.neverLine')} {t('targets.plan.keepsHour', { time: words.on })}
        </p>
      ) : (
        <p className={styles.note}>{t('targets.plan.night', { from: words.off, to: words.on, hours: words.nightHours })}</p>
      )}
      {hardStart ? <p className={styles.note}>{t('targets.plan.hardStart', { time: words.on })}</p> : null}
    </div>
  );
}

/** What holds at this moment, by what the device runs, and until when. */
function NowLine({ storedShape, baseline, offset, holding, offline }: LightPlanProps) {
  const { t } = useTranslation();
  const half = holding.half;
  if (!half) return null;
  const by = holding.by;
  const words = windowWords(baseline, offset);
  const regime = storedShape.regime;
  if (regime !== 'cycle' && regime !== 'always' && regime !== 'never' && regime !== 'sensor') return null;

  const line =
    offline !== null
      ? t('targets.plan.now.offline', { offline, half: t(`targets.plan.half.${half}`) })
      : regime === 'sensor'
        ? t(`targets.plan.now.sensor.${half}`)
        : regime === 'always'
          ? t('targets.plan.now.always')
          : regime === 'never'
            ? t('targets.plan.now.never')
            : holding.glide
              ? t(`targets.plan.now.glide.${holding.glide.to}`, { time: holding.glide.until })
              : // A lamp at 0 % switches nothing: what changes at those times is the half.
                t(`targets.plan.now.${half}${baseline.lightLimit <= 0 ? 'Dark' : ''}`, { time: half === 'day' ? words.off : words.on });

  return (
    <p className={styles.nowLine} data-by={offline !== null ? 'schedule' : by} role="status">
      <span className={styles.nowDot} data-half={half} aria-hidden />
      {line}
    </p>
  );
}

/**
 * What saving the schedule would do at once: a light-on time moved past now
 * lights the lamp in the middle of a night, and a shorter day can end one on
 * the spot. Said only where the half really turns over.
 */
function Flip({ device, storedShape, shape, draft, holding, now, changed }: LightPlanProps & { changed: boolean }) {
  const { t } = useTranslation();
  if (!changed || !holding.half) return null;
  const scheduled = (regime: Shape['regime']) => regime === 'cycle' || regime === 'always' || regime === 'never';
  if (!scheduled(storedShape.regime) || !scheduled(shape.regime)) return null;

  const after: Half =
    shape.regime === 'always'
      ? 'day'
      : shape.regime === 'never'
        ? 'night'
        : halfOf(phaseOf(draft, rampsFor(device, device.configuration, draft), now));
  if (after === holding.half) return null;

  return (
    <p className={styles.consequence} role="status">
      {t(`targets.plan.flips.${after}`)}
    </p>
  );
}

const minutesOf = (seconds: number): number => ((Math.round(seconds / 60) % 1440) + 1440) % 1440;

interface Piece {
  from: number;
  to: number;
  up: boolean;
  down: boolean;
}

/** A window from midnight to midnight, in minutes: one piece, or two where it runs past midnight. */
const piecesOf = (startMinutes: number, minutes: number): Piece[] => {
  if (minutes <= 0) return [];
  // A day that never ends has no ramp anywhere: the lamp stays at its limit.
  if (minutes >= 1440) return [{ from: 0, to: 1440, up: false, down: false }];
  const end = startMinutes + minutes;
  return end <= 1440
    ? [{ from: startMinutes, to: end, up: true, down: true }]
    : [
        { from: startMinutes, to: 1440, up: true, down: false },
        { from: 0, to: end - 1440, up: false, down: true },
      ];
};

/**
 * Today from midnight to midnight on the account's clock: lit while the light
 * is on, fading in and out over the dimming ramps, with now marked. A window
 * that runs past midnight is two pieces, one at each end; 24 hours is the
 * whole bar, without a ramp. A draft is a thin outlined track
 * under it, so what is being typed is never drawn as what runs.
 */
function Bar({
  schedule,
  draft,
  ramps,
  dim,
  offset,
  nowMinutes,
  label,
  draftLabel,
}: {
  schedule: TargetsDraft;
  draft: TargetsDraft | null;
  ramps: Ramps;
  /** The lamp's limit is 0 %: the day is still a day, but nothing shines in it. */
  dim: boolean;
  offset: number;
  nowMinutes: number;
  label: string;
  draftLabel: string;
}) {
  const start = (on: number) => minutesOf(on + offset);
  const lit = piecesOf(start(schedule.lightsOn), Math.round(schedule.lightHours * 60));
  const drafted = draft ? piecesOf(start(draft.lightsOn), Math.round(draft.lightHours * 60)) : [];

  return (
    <div className={styles.bar}>
      <div className={styles.tracks}>
        <div className={styles.track} role="img" aria-label={label}>
          {lit.map(piece => {
            const width = piece.to - piece.from;
            const up = piece.up ? Math.min(50, (ramps.up / width) * 100) : 0;
            const down = piece.down ? Math.min(50, (ramps.down / width) * 100) : 0;
            return (
              <span
                key={piece.from}
                className={styles.lit}
                data-dim={dim || undefined}
                style={{
                  left: `${(piece.from / 1440) * 100}%`,
                  width: `${(width / 1440) * 100}%`,
                  background: `linear-gradient(to right, transparent 0%, var(--lit) ${up}%, var(--lit) ${100 - down}%, transparent 100%)`,
                }}
              />
            );
          })}
        </div>
        {draft ? (
          <div className={styles.draftTrack} role="img" aria-label={draftLabel}>
            {drafted.map(piece => (
              <span
                key={piece.from}
                className={styles.draftLit}
                style={{ left: `${(piece.from / 1440) * 100}%`, width: `${((piece.to - piece.from) / 1440) * 100}%` }}
              />
            ))}
          </div>
        ) : null}
        <span className={styles.barNow} style={{ left: `${(nowMinutes / 1440) * 100}%` }} aria-hidden />
      </div>
      <div className={`mono ${styles.ticks}`} aria-hidden>
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
