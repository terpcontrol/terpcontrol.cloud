import { CalendarRange } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, DeviceConfiguration, PendingSetting } from '@fg2/shared-types/v1';
import { controlPath } from '@/app/places';
import type { Translate } from '@/i18n/i18n';
import { figureOf } from '@/ui/climate-hardware';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { useZone } from '@/ui/zone';
import { heldWords, useHeldLight } from '../held-light';
import { hasDay, type Field, type NowHolding, type Shape } from '../targets/day-night';
import { scheduleTitle, windowWords } from '../targets/schedule-words';
import { Stepper } from '../targets/Stepper';
import type { LightSchedule, TargetsDraft } from '../targets/targets-draft';
import { FIGURES, figureText, pendingFigure, pendingWindow, type PendingItem } from './figures';
import { LightSheet } from './LightSheet';
import { PendingNote } from './Pending';
import styles from './Climate.module.css';

/** How long a stepped figure rests before it is sent: the first step of a series would already pause a running plan. */
const REST_MS = 1500;

/**
 * The light of one lamp - a controller's, a fridge's, a stand-alone LIGHT's:
 * its window, with "Ändern" opening the day's plan on its sheet, and the
 * limit it is dimmed to, stepped where it stands and sent once it rests. A
 * lamp held by hand says so over its times, with the way to the hold's own
 * control under Ausgänge.
 */
export function LightCard({
  device,
  stored,
  shape,
  baseline,
  now,
  offset,
  holding,
  offline,
  pending,
  owned = NOTHING,
  plan = null,
  longest,
  mayManage,
  busy,
  error,
  pauses = () => null,
  onTimes,
  onLimit,
}: {
  /** The device whose lamp it is, its document read as a controller's is. */
  device: Device;
  stored: DeviceConfiguration;
  shape: Shape;
  baseline: TargetsDraft;
  now: DateTime;
  offset: number;
  holding: NowHolding;
  /** "Offline seit 10:19", for a device not heard from. */
  offline: string | null;
  pending: ReadonlyMap<string, PendingSetting>;
  /** The figures a running plan writes back every hour. */
  owned?: ReadonlySet<Field>;
  /** The running plan, and the schedule its step puts back where that is not the one that runs. */
  plan?: { name: string; sets: LightSchedule | null } | null;
  longest?: number;
  mayManage: boolean;
  busy: boolean;
  error: Error | null;
  /** The plan a save of this draft pauses, by name; null where it pauses none. */
  pauses?: (next: TargetsDraft) => string | null;
  onTimes: (next: TargetsDraft) => Promise<boolean>;
  onLimit: (value: number) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const [open, setOpen] = useState(false);
  const held = useHeldLight(device, now);
  const limit = useResting(baseline.lightLimit, onLimit);
  const regime = shape.regime;
  const words = windowWords(baseline, offset);
  const scheduled = regime === 'cycle' || regime === 'always' || regime === 'never';
  const windowHeld = pendingWindow(pending, { day: figureOf(stored, 'daynight', 'day'), night: figureOf(stored, 'daynight', 'night') });
  const limitHeld = hasDay(regime) ? pendingFigure(pending, 'lightLimit') : undefined;
  const planSets = plan?.sets ? { name: plan.name, schedule: plan.sets } : null;
  const waiting: PendingItem[] = [
    ...(windowHeld
      ? [
          {
            name: t('control.light.times'),
            value: scheduleWords(t, baseline, offset),
            held: windowHeld.held ? scheduleWords(t, windowHeld.held, offset) : null,
            savedAt: windowHeld.savedAt,
            one: true,
          },
        ]
      : []),
    ...(limitHeld
      ? [
          {
            name: t('targets.aria.lightLimit'),
            value: figureText('lightLimit', baseline.lightLimit),
            held: typeof limitHeld.held === 'number' ? figureText('lightLimit', limitHeld.held) : null,
            savedAt: limitHeld.savedAt,
          },
        ]
      : []),
  ];

  return (
    <section className={`${styles.card} ${styles.light}`} aria-labelledby={`light-${device.id}`}>
      <h2 className={styles.title} id={`light-${device.id}`}>
        {t('control.light.title')}
      </h2>
      {held ? (
        <p className={styles.held} role="status">
          {heldWords(t, held, now, zone)}
          {mayManage && device.spaceId ? (
            <Link to={controlPath(device.spaceId, 'outputs', { device: device.id })} className={styles.heldWay}>
              {t('control.light.toAuto')} ›
            </Link>
          ) : null}
        </p>
      ) : null}
      {scheduled ? (
        <div className={styles.line}>
          <p className={styles.says} data-pending={windowHeld !== null || undefined}>
            {words.always || words.never ? (
              scheduleTitle(t, baseline, offset)
            ) : (
              <>
                <span className={styles.short}>
                  {unbroken(t('control.light.on', { time: words.on, hours: words.hours }))}
                  <span className={styles.sub}>{t('control.light.off', { time: words.off })}</span>
                </span>
                {/* Beside the rail the three stand in one line, and break between two of them where they must. */}
                <span className={styles.long}>
                  <Facts
                    facts={[...factsOf(t('control.light.on', { time: words.on, hours: words.hours })), t('control.light.off', { time: words.off })]}
                  />
                </span>
              </>
            )}
            {owned.has('lightHours') || owned.has('lightsOn') ? <PlanMark /> : null}
          </p>
          {mayManage ? (
            <button type="button" className={styles.pillButton} aria-label={t('control.light.change')} onClick={() => setOpen(true)}>
              <span className={styles.short}>{t('control.change')}</span>
              <span className={styles.long}>{t('control.light.change')}</span>
            </button>
          ) : null}
        </div>
      ) : (
        // Drying and germination have no light to plan: the lamp stays off, and the plan that comes back after is said.
        <p className={styles.says}>
          {t(`targets.plan.${regime as 'drying' | 'germination'}`)}
          <span className={styles.sub}>
            {t(`targets.plan.${regime as 'drying' | 'germination'}Line`, { window: scheduleTitle(t, baseline, offset) })}
          </span>
        </p>
      )}
      {scheduled && planSets ? (
        <p className={styles.warn}>{t('targets.plan.planSets', { name: planSets.name, window: scheduleTitle(t, planSets.schedule, offset) })}</p>
      ) : null}
      {hasDay(regime) ? (
        <div className={styles.line}>
          <span className={styles.limitLabel}>
            <span className={styles.short}>{t('targets.aria.lightLimit')}</span>
            <span className={styles.long}>{t('control.light.limit')}</span>
            <Help topic="lightLimit" />
            {owned.has('lightLimit') ? <PlanMark /> : null}
          </span>
          {mayManage ? (
            <span className={styles.nudge}>
              <Stepper
                name={t('targets.aria.lightLimit')}
                value={limit.value}
                min={FIGURES.lightLimit.min}
                max={FIGURES.lightLimit.max}
                step={FIGURES.lightLimit.step}
                decimals={FIGURES.lightLimit.decimals}
                unit={t('targets.unit.percent')}
                less={t('control.light.lower')}
                more={t('control.light.raise')}
                changed={limit.resting}
                pending={limitHeld !== undefined}
                onChange={limit.set}
              />
            </span>
          ) : (
            <span className={styles.nudgeFigure} data-pending={limitHeld !== undefined || undefined}>
              {figureText('lightLimit', baseline.lightLimit)}
            </span>
          )}
        </div>
      ) : null}
      {hasDay(regime) && baseline.lightLimit <= 0 ? <p className={styles.warn}>{t('targets.table.zeroLimit')}</p> : null}
      <PendingNote items={waiting} />
      {open ? null : <Refused error={limit.failed ? error : null} />}
      {open ? (
        <LightSheet
          device={device}
          shape={shape}
          baseline={baseline}
          now={now}
          offset={offset}
          holding={holding}
          offline={offline}
          owned={owned}
          planSets={planSets}
          longest={longest}
          pauses={pauses}
          busy={busy}
          error={error}
          onSave={onTimes}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

const NOTHING: ReadonlySet<Field> = new Set();

/** The mark on a figure a running plan writes back every hour. */
export function PlanMark() {
  const { t } = useTranslation();
  return <CalendarRange size={13} strokeWidth={2} className={styles.planMark} role="img" aria-label={t('targets.table.planMark')} />;
}

/** "An um 06:00 · 18 Std", or the words for a lamp that never goes off or never comes on. */
const scheduleWords = (t: Translate, schedule: LightSchedule, offset: number): string => {
  const words = windowWords(schedule, offset);
  return words.always || words.never ? scheduleTitle(t, schedule, offset) : unbroken(t('control.light.on', { time: words.on, hours: words.hours }));
};

/**
 * A figure stepped where it stands and sent once it rests: the steps of a
 * series are one write, and one line in the toast. Left with a step still
 * resting - another page, a sheet - it is sent at once rather than dropped.
 */
function useResting(stored: number, send: (value: number) => Promise<boolean>) {
  const [stepped, setStepped] = useState<{ value: number; against: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const waiting = useRef<number | null>(null);
  const latest = useRef(send);
  useEffect(() => {
    latest.current = send;
  });

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const value = waiting.current;
    waiting.current = null;
    if (value !== null) void latest.current(value).then(done => setFailed(!done));
  }, []);
  useEffect(() => flush, [flush]);

  // The stepped figure holds until the stored one moves: a save in flight does not snap it back.
  const value = stepped && stepped.against === stored ? stepped.value : stored;

  return {
    value,
    resting: stepped !== null && stepped.against === stored && stepped.value !== stored,
    failed,
    set: (next: number) => {
      setFailed(false);
      setStepped({ value: next, against: stored });
      waiting.current = next === stored ? null : next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, REST_MS);
    },
  };
}
