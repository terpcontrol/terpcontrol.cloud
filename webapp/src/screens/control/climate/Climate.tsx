import { CalendarRange } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfiguration, GerminationChoices as ChoiceValues } from '@fg2/shared-types/v1';
import { useDeviceLive, useHeardAt, useLiveReads, useSaveConfiguration } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition, useStopPlan } from '@/api/plans';
import type { Translate } from '@/i18n/i18n';
import { useLog } from '@/log/log-context';
import { deviceLiveness, offlineLabel } from '@/ui/age';
import { Asking } from '@/ui/Asking';
import { figureOf, hasCo2Sensor } from '@/ui/climate-hardware';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';
import { Help, Term } from '@/ui/Help';
import { deviceName } from '@/ui/naming';
import { LoadFailed, RefreshFailed, Refused, Waiting } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, type ClimateChoice } from '@/ui/presets';
import { figure, targetWithUnit } from '@/ui/units';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { offsetOf, wallClock } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { choicesOf, choicesSaid, useHumidifier } from '../germination/germination-choices';
import { stepLightHours, stepLightsOn } from '../plan-edit';
import {
  changedFields,
  halvesOf,
  hasDay,
  heldOf,
  holdsHumidity,
  nowHoldingOf,
  ownedBy,
  runningStep,
  shapeOf,
  type Half,
  type Regime,
  type Shape,
} from '../targets/day-night';
import { ControlOff } from '../Mode';
import { scheduleTitle, windowWords } from '../targets/schedule-words';
import { Stepper } from '../targets/Stepper';
import { draftOf, equalsPreset, leafOffset, presetOf, vpdOf, withDraft, type LightSchedule, type TargetsDraft } from '../targets/targets-draft';
import { FigureSheet } from './FigureSheet';
import {
  FIGURES,
  figureName,
  figureText,
  MODE_PATHS,
  pendingByPath,
  pendingFigure,
  pendingWindow,
  savedWords,
  spellChangeOf,
  type FigureField,
} from './figures';
import { LightSheet } from './LightSheet';
import { PresetSheet } from './PresetSheet';
import styles from './Climate.module.css';

/**
 * What one device holds a place at: its light, and the targets by day and by
 * night - Steuerung's top for the device that is the place's climate, and the
 * same two cards on the page of any other device that holds targets of its own.
 *
 * Nothing here is a draft. A figure is a button that opens a small sheet for
 * that one figure, the light's times and a preset have a sheet each, and the
 * light limit is stepped where it stands and sent once it rests. Every write
 * is answered by the toast, which names what changed and takes it back.
 *
 * A device that is not heard is set all the same: the cloud stores the change
 * and hands it over when the device connects again. What it has not been
 * handed is marked and said under the card, with what it still holds - by the
 * server's own reckoning (`pending`), never by a guess of the page's.
 */

/** How long a stepped figure rests before it is sent: the first step of a series would already pause a running plan. */
const REST_MS = 1500;

interface ClimateWrite {
  next: TargetsDraft;
  /** The preset taken, which says whether a drying spell or a germination starts or ends with it. */
  chip?: ClimateChoice | null;
  choices?: ChoiceValues;
  /** What changed, as the toast says it: "Temperatur am Tag 24,0 °C". */
  label: string;
}

type Open = { kind: 'figure'; field: FigureField } | { kind: 'light' } | { kind: 'preset' } | null;

export function Climate({ device, stored, mayManage }: { device: Device; stored: DeviceConfiguration; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { tell } = useLog();
  const plan = useDevicePlan(device.id);
  const liveRead = useDeviceLive(device.id);
  const save = useSaveConfiguration();
  const move = usePlanTransition(device.id);
  const stop = useStopPlan(device.id);
  const humidifier = useHumidifier(device);
  const heard = useHeardAt(device);
  const spoke = useLiveReads([device.id]).measuredAt.get(device.id) ?? heard;
  const [open, setOpen] = useState<Open>(null);
  const [stopping, setStopping] = useState(false);

  const name = deviceName(device, t);
  const offset = offsetOf(now, zone);
  const isOffline = deviceLiveness(heard, now) === 'offline';
  const offline = isOffline ? offlineLabel(spoke, now, zone, true) : null;
  const baseline = draftOf(stored);
  const climateOnly = device.type === 'fan';
  const hasCo2 = hasCo2Sensor(device);
  const storedChoices = choicesOf(device);
  const shape = shapeOf(device, baseline, { climateOnly, humidified: humidifier && storedChoices.humidifierHolds });
  const regime = shape.regime;
  const holding = nowHoldingOf({
    device,
    shape,
    stored: baseline,
    live: liveRead.data,
    offline: isOffline,
    awaiting: liveRead.isPending,
    now,
    clock: seconds => wallClock(seconds, offset),
  });
  const status = plan.data?.state.status ?? null;
  const step = runningStep(plan.data);
  const owned = ownedBy(step);
  const planName = plan.data?.name ?? '';
  const pending = pendingByPath(liveRead.data?.pending);
  const busy = save.isPending || move.isPending || stop.isPending;

  /** Whether writing `next` puts back by hand what the running plan's step writes, so the plan has to pause first. */
  const pausesFor = (next: TargetsDraft, chip: ClimateChoice | null = null, choices?: ChoiceValues): boolean => {
    const spell = spellChangeOf(chip, device, 'drying') !== null || spellChangeOf(chip, device, 'germination') !== null;
    const choicesMoved = choices !== undefined && (step?.germinationChoices ?? null) !== null;
    return status === 'running' && (spell || choicesMoved || changedFields(next, baseline).some(field => owned.has(field)));
  };

  const write = async ({ next, chip = null, choices, label }: ClimateWrite): Promise<boolean> => {
    const dryingChange = spellChangeOf(chip, device, 'drying');
    const germinationChange = spellChangeOf(chip, device, 'germination');
    const drying = device.control && chip ? chip.stage === 'drying' : undefined;
    const germination = device.control && chip ? chip.stage === 'germination' : undefined;
    const after = shapeOf(device, next, {
      drying: drying ?? device.control?.drying ?? false,
      germination: germination ?? device.control?.mode === 'germination',
      climateOnly,
      humidified: humidifier && (choices ?? storedChoices).humidifierHolds,
    });
    const pauses = pausesFor(next, chip, choices);
    const moved = changedFields(next, baseline);

    try {
      // The reason the plan's card gives says what was done by hand.
      if (pauses)
        await move.mutateAsync({ kind: 'pause', reason: t(moved.length > 0 || chip ? 'targets.pauseReason' : 'targets.pauseReasonGermination') });
      const answer = await save.mutateAsync({
        deviceId: device.id,
        // A spell begun here stores what it holds in both halves; once a fridge is drying the server keeps its stored day.
        configuration: withDraft(stored, next, climateOnly, dryingChange === 'starts' ? heldOf(after.regime) : 'both'),
        drying,
        germination,
        germinationChoices: after.regime === 'germination' && choices ? choicesSaid(choices, humidifier) : undefined,
      });
      // A spell that began or ended moved more than figures - the mode, what is kept for after it - and is not one write to take back.
      const whole = dryingChange === null && germinationChange === null && choices === undefined;
      tell({
        label: t(isOffline ? 'control.saved.later' : 'control.saved.now', { what: label, device: name }),
        undo: whole
          ? async () => {
              const back = { ...draftOf(answer.configuration), ...Object.fromEntries(moved.map(field => [field, baseline[field]])) };
              await save.mutateAsync({ deviceId: device.id, configuration: withDraft(answer.configuration, back, climateOnly) });
              if (pauses) await move.mutateAsync({ kind: 'resume' });
            }
          : null,
      });
      return true;
    } catch {
      // Said under the control that asked, from the write that was refused.
      return false;
    }
  };

  const limit = useResting(baseline.lightLimit, value =>
    write({ next: { ...baseline, lightLimit: value }, label: `${t('targets.aria.lightLimit')} ${figureText('lightLimit', value)}` }),
  );

  if (plan.isPending) return <Waiting lines={4} />;
  // Whether a save has to pause a plan first is not guessed at: a plan that could not be read is a card that cannot be drawn yet.
  if (!plan.data && !isMissing(plan.error)) return <LoadFailed retry={() => void plan.refetch()} />;

  if (regime === 'off') {
    return <ControlOff device={device} mayManage={mayManage} />;
  }

  const halves = halvesOf(regime);
  const words = windowWords(baseline, offset);
  const scheduled = regime === 'cycle' || regime === 'always' || regime === 'never';
  const window = pendingWindow(pending, { day: figureOf(stored, 'daynight', 'day'), night: figureOf(stored, 'daynight', 'night') });
  const savedAt = (at: string) => savedWords(t, at, now, zone);
  const planSets = planScheduleOf(step, baseline);
  const preset = CLIMATE_CHOICES.find(chip => chosenBy(chip, baseline, shape, hasCo2, climateOnly)) ?? null;
  const rows = [
    { key: 'temperature', label: t('targets.table.temperature'), fields: { day: 'dayTemperature', night: 'nightTemperature' } },
    ...(holdsHumidity(shape)
      ? [{ key: 'humidity', label: t('targets.table.humidity'), fields: { day: 'dayHumidity', night: 'nightHumidity' } }]
      : []),
    ...(hasDay(regime) && hasCo2 ? [{ key: 'co2', label: t('targets.table.co2'), fields: { day: 'co2', night: null } }] : []),
  ] as { key: string; label: string; fields: Record<Half, FigureField | null> }[];
  const shown = rows.flatMap(row => halves.flatMap(half => (row.fields[half] ? [row.fields[half]] : [])));
  const waiting = shown.flatMap(field => {
    const held = pendingFigure(pending, field);
    return held ? [{ field, held }] : [];
  });
  const limitHeld = hasDay(regime) ? pendingFigure(pending, 'lightLimit') : undefined;
  const modeHeld = pending.get(MODE_PATHS[0]);

  return (
    <>
      <RefreshFailed failedAt={plan.isError && plan.data ? plan.dataUpdatedAt : null} now={now} />

      {regime === 'sensor' ? null : (
        <section className={`${styles.card} ${styles.light}`} aria-labelledby={`light-${device.id}`}>
          <h2 className={styles.title} id={`light-${device.id}`}>
            {t('control.light.title')}
          </h2>
          {scheduled ? (
            <div className={styles.line}>
              <p className={styles.says} data-pending={window !== null || undefined}>
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
                        facts={[
                          ...factsOf(t('control.light.on', { time: words.on, hours: words.hours })),
                          t('control.light.off', { time: words.off }),
                        ]}
                      />
                    </span>
                  </>
                )}
              </p>
              {mayManage ? (
                <button type="button" className={styles.pillButton} aria-label={t('control.light.change')} onClick={() => setOpen({ kind: 'light' })}>
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
            <p className={styles.warn}>{t('targets.plan.planSets', { name: planName, window: scheduleTitle(t, planSets, offset) })}</p>
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
                    changed={limitHeld !== undefined || limit.resting}
                    onChange={limit.set}
                  />
                </span>
              ) : (
                <span className={styles.nudgeFigure}>{figureText('lightLimit', baseline.lightLimit)}</span>
              )}
            </div>
          ) : null}
          {hasDay(regime) && baseline.lightLimit <= 0 ? <p className={styles.warn}>{t('targets.table.zeroLimit')}</p> : null}
          {window ? (
            <p className={styles.pending} role="status">
              {t(window.held ? 'control.pending.window' : 'control.pending.unknown', {
                name: t('control.light.times'),
                value: scheduleWords(t, baseline, offset),
                saved: savedAt(window.savedAt),
                held: window.held ? scheduleWords(t, window.held, offset) : '',
              })}
            </p>
          ) : null}
          {limitHeld ? (
            <p className={styles.pending} role="status">
              {pendingSentence(
                t,
                t('targets.aria.lightLimit'),
                figureText('lightLimit', baseline.lightLimit),
                savedAt(limitHeld.savedAt),
                heldText('lightLimit', limitHeld.held),
              )}
            </p>
          ) : null}
          {open?.kind !== 'light' ? <Refused error={limit.failed ? save.error : null} /> : null}
        </section>
      )}

      <section className={styles.card} aria-labelledby={`targets-${device.id}`}>
        <div className={styles.line}>
          <h2 className={styles.title} id={`targets-${device.id}`}>
            {t('targets.title')}
          </h2>
          {mayManage ? (
            <button type="button" className={styles.pillButton} onClick={() => setOpen({ kind: 'preset' })}>
              {preset ? t('control.preset.named', { name: climateChoiceName(t, preset) }) : t('control.preset.open')}
            </button>
          ) : null}
        </div>
        {regime === 'sensor' ? <p className={styles.note}>{t('targets.plan.sensor')}</p> : null}

        <div className={styles.grid} role="table" aria-label={t('targets.table.label')} data-single={halves.length === 1 || undefined}>
          <div role="row" className={styles.gridRow}>
            <span role="columnheader" aria-label={t('targets.table.figure')} />
            {halves.map(half => (
              <span key={half} role="columnheader" className={styles.half}>
                {halfName(t, regime, half)}
                {holding.half === half && halves.length > 1 ? (
                  <span className={styles.now} data-by={offline !== null ? 'schedule' : holding.by}>
                    {t(offline !== null || holding.by === 'schedule' ? 'targets.table.bySchedule' : 'targets.table.now')}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          {rows.map(row => (
            <div role="row" className={styles.gridRow} key={row.key}>
              <span role="rowheader" className={styles.rowLabel}>
                {row.label}
                {halves.some(half => row.fields[half] && owned.has(row.fields[half])) ? <PlanMark /> : null}
              </span>
              {halves.map(half => {
                const field = row.fields[half];
                if (!field) {
                  return (
                    <span role="cell" key={half} className={styles.none}>
                      {t('targets.table.co2Night')}
                    </span>
                  );
                }
                const text = figureText(field, baseline[field]);
                const held = pendingFigure(pending, field);
                return (
                  <span role="cell" key={half}>
                    {mayManage ? (
                      <button
                        type="button"
                        className={styles.figure}
                        data-pending={held !== undefined || undefined}
                        aria-label={t(held ? 'control.figure.changePending' : 'control.figure.change', {
                          name: figureName(t, field, regime),
                          value: spaced(text),
                        })}
                        onClick={() => setOpen({ kind: 'figure', field })}
                      >
                        {text}
                      </button>
                    ) : (
                      <span className={styles.figure} data-pending={held !== undefined || undefined} data-read>
                        {text}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        {holdsHumidity(shape) ? (
          <Facts
            className={styles.vpd}
            facts={halves.map(half => (
              <Term key={half} topic="vpd">
                {t(halves.length > 1 ? `control.vpd.${half}` : 'targets.table.vpd', { value: vpdText(device, baseline, half) })}
              </Term>
            ))}
          />
        ) : null}
        {status === 'running' && owned.size > 0 ? (
          <p className={styles.note}>
            <CalendarRange size={13} strokeWidth={2} className={styles.planMark} aria-hidden /> {t('targets.planTable.legend', { name: planName })}
          </p>
        ) : null}
        <Kept device={device} shape={shape} baseline={baseline} hasCo2={hasCo2} />
        {/* A mode stored for a silent device changes what this card shows, while the device still runs the mode it had. */}
        {modeHeld && device.control ? (
          <p className={styles.pending} role="status">
            {pendingSentence(
              t,
              t('operatingMode.label'),
              t(`operatingMode.${device.control.drying ? 'drying' : device.control.mode}`),
              savedAt(modeHeld.savedAt),
              null,
            )}
          </p>
        ) : null}
        {waiting.map(({ field, held }) => (
          <p className={styles.pending} role="status" key={field}>
            {pendingSentence(t, figureName(t, field, regime), figureText(field, baseline[field]), savedAt(held.savedAt), heldText(field, held.held))}
          </p>
        ))}
      </section>

      {/* Paused is where a plan lands once a figure it writes is set by hand, and the way out of it stands where that was done. */}
      {status === 'paused' ? (
        <section className={styles.paused} role="status">
          <p>{plan.data?.state.pauseReason ? t('targets.planPausedFor', { reason: plan.data.state.pauseReason }) : t('targets.planPaused')}</p>
          {mayManage ? (
            <div className={styles.pausedMoves}>
              <button type="button" className={ui.button} disabled={busy} onClick={() => move.mutate({ kind: 'resume' })}>
                {t('targets.resume')}
              </button>
              <button type="button" className={`${ui.button} ${ui.danger}`} disabled={busy} onClick={() => setStopping(!stopping)}>
                {t('space.control.move.stop')}
              </button>
              <Help topic="resumePlan" />
            </div>
          ) : null}
          {mayManage && stopping ? (
            <Asking
              note={t('space.control.ask.stop')}
              yes={t('space.control.ask.stopYes')}
              danger
              busy={busy}
              onYes={() => stop.mutate(undefined, { onSuccess: () => setStopping(false) })}
              onCancel={() => setStopping(false)}
            />
          ) : null}
          {open === null ? <Refused error={move.error ?? stop.error} /> : null}
        </section>
      ) : null}

      {open?.kind === 'figure' ? (
        <FigureSheet
          key={open.field}
          device={device}
          field={open.field}
          regime={regime}
          baseline={baseline}
          pauses={next => (pausesFor(next) ? planName : null)}
          busy={busy}
          error={save.error ?? move.error}
          onSave={next => write({ next, label: `${figureName(t, open.field, regime)} ${figureText(open.field, next[open.field])}` })}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'light' ? (
        <LightSheet
          device={device}
          shape={shape}
          baseline={baseline}
          now={now}
          offset={offset}
          holding={holding}
          offline={offline}
          owned={owned}
          planSets={planSets ? { name: planName, schedule: planSets } : null}
          pauses={next => (pausesFor(next) ? planName : null)}
          busy={busy}
          error={save.error ?? move.error}
          onSave={next => write({ next, label: scheduleTitle(t, next, offset) })}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'preset' ? (
        <PresetSheet
          device={device}
          shape={shape}
          baseline={baseline}
          hasCo2={hasCo2}
          humidifier={humidifier}
          chosen={preset}
          pauses={(next, chip, choices) => (pausesFor(next, chip, choices) ? planName : null)}
          busy={busy}
          error={save.error ?? move.error}
          onSave={(next, chip, choices) => write({ next, chip, choices, label: t('control.preset.taken', { name: climateChoiceName(t, chip) }) })}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/** The mark on a figure a running plan writes back every hour. */
function PlanMark() {
  const { t } = useTranslation();
  return <CalendarRange size={13} strokeWidth={2} className={styles.planMark} role="img" aria-label={t('targets.table.planMark')} />;
}

/**
 * What the grid leaves out, said under it: the half a regime of one column
 * keeps for later - the night at 24 hours of light, the day at none - and what
 * germination gives back to the night when it ends.
 */
function Kept({ device, shape, baseline, hasCo2 }: { device: Device; shape: Shape; baseline: TargetsDraft; hasCo2: boolean }) {
  const { t } = useTranslation();
  const regime = shape.regime;
  const pair = (temperature: number, humidity: number) =>
    [targetWithUnit(temperature, 'temperature'), holdsHumidity(shape) ? targetWithUnit(humidity, 'humidity') : null].filter(
      (part): part is string => part !== null,
    );
  const after = regime === 'germination' ? (device.control?.afterGermination ?? null) : null;
  const before = after?.nightTemperature ?? null;
  const humidityBefore = after?.nightHumidity ?? null;
  const backHumidity = humidityBefore !== null && humidityBefore !== baseline.nightHumidity ? humidityBefore : null;
  const back = (before !== null && before !== baseline.nightTemperature) || backHumidity !== null ? (before ?? baseline.nightTemperature) : null;
  const kept =
    regime === 'always'
      ? { summary: t('targets.table.keptNight'), parts: pair(baseline.nightTemperature, baseline.nightHumidity) }
      : regime === 'never'
        ? {
            summary: t('targets.table.keptDay'),
            parts: [
              ...pair(baseline.dayTemperature, baseline.dayHumidity),
              ...(hasCo2 ? [`CO₂ ${targetWithUnit(baseline.co2, 'co2')}`] : []),
              t('targets.table.keptLight', { percent: Math.round(baseline.lightLimit) }),
            ],
          }
        : null;

  return (
    <>
      {back !== null ? (
        <p className={styles.note}>
          {unbroken(
            backHumidity !== null
              ? t('targets.table.germinationBackHumidity', {
                  temperature: targetWithUnit(back, 'temperature'),
                  humidity: targetWithUnit(backHumidity, 'humidity'),
                })
              : t('targets.table.germinationBack', { temperature: targetWithUnit(back, 'temperature') }),
          )}
        </p>
      ) : null}
      {kept ? (
        <p className={styles.note}>
          {kept.summary}: <Facts facts={kept.parts} />
        </p>
      ) : null}
    </>
  );
}

/** What a column is called: the half of the day, or what the device holds round the clock instead. */
const halfName = (t: Translate, regime: Regime, half: Half): string =>
  regime === 'cycle'
    ? t(`control.half.${half}`)
    : regime === 'sensor'
      ? t(half === 'day' ? 'targets.table.brightTitle' : 'targets.table.darkTitle')
      : regime === 'always' || regime === 'never'
        ? t('targets.table.roundTheClock')
        : t(`targets.table.${regime as 'drying' | 'germination'}Title`);

/** "An um 06:00 · 18 Std", or the words for a lamp that never goes off or never comes on. */
const scheduleWords = (t: Translate, schedule: LightSchedule, offset: number): string => {
  const words = windowWords(schedule, offset);
  return words.always || words.never ? scheduleTitle(t, schedule, offset) : unbroken(t('control.light.on', { time: words.on, hours: words.hours }));
};

const vpdText = (device: Device, draft: TargetsDraft, half: Half): string =>
  figure(
    vpdOf(
      half === 'day' ? draft.dayTemperature : draft.nightTemperature,
      half === 'day' ? draft.dayHumidity : draft.nightHumidity,
      leafOffset(device.settings, half),
    ),
    'vpd',
  );

/** A figure as it is spoken: the space that keeps it with its unit on a line is a space to a screen reader. */
const spaced = (text: string): string => text.replace(/\u00a0/g, ' ');

/** What a silent device still holds for a figure, written as the figure is; null where the cloud does not know. */
const heldText = (field: FigureField, held: number | string | null): string | null => (typeof held === 'number' ? figureText(field, held) : null);

/** "Temperatur am Tag: 24,0 °C gespeichert um 14:31. Am Gerät gelten noch 25,0 °C, bis es wieder online ist." */
const pendingSentence = (t: Translate, name: string, value: string, saved: string, held: string | null): string =>
  t(held === null ? 'control.pending.unknown' : 'control.pending.figure', { name, value, saved, held: held ?? '' });

/**
 * Whether the stored figures are what a preset writes, which names it on the
 * button. Germination is told by the dark it runs in as much as by its
 * figures, and its humidity counts only where a humidifier holds it.
 */
const chosenBy = (chip: ClimateChoice, draft: TargetsDraft, shape: Shape, hasCo2: boolean, climateOnly: boolean): boolean => {
  const preset = presetOf(chip);
  if (preset === null || (chip.stage === 'germination') !== (shape.regime === 'germination')) return false;
  if ((chip.stage === 'drying') !== (shape.regime === 'drying')) return false;
  const shown = chip.stage === 'germination' && !holdsHumidity(shape) ? { ...preset, nightHumidity: null } : preset;
  return equalsPreset(draft, shown, hasCo2, climateOnly);
};

/**
 * The light schedule a running plan's step puts back within the hour, where
 * it differs from the one that runs: a step's light hours from the device's
 * hour, or a migrated step's own two times.
 */
const planScheduleOf = (step: ReturnType<typeof runningStep>, runs: TargetsDraft): LightSchedule | null => {
  if (!step) return null;
  const on = stepLightsOn(step.settings);
  const hours = stepLightHours({ settings: step.settings, lightHours: step.lightHours ?? null });
  if (on === null && hours === null) return null;
  const schedule = { lightsOn: on ?? runs.lightsOn, lightHours: hours ?? runs.lightHours };
  return schedule.lightsOn === runs.lightsOn && schedule.lightHours === runs.lightHours ? null : schedule;
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
