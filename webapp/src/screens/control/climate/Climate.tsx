import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfiguration, GerminationChoices as ChoiceValues } from '@fg2/shared-types/v1';
import { readConfiguration, useConfigure, useDeviceLive, useHeardAt, useLiveReads, useSaveConfiguration } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { useSpaceOverview } from '@/api/spaces';
import type { Translate } from '@/i18n/i18n';
import { offlineLabel } from '@/ui/age';
import { hasCo2Sensor } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { Term } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { CLIMATE_CHOICES, climateChoiceName, writesClimate, type ClimateChoice } from '@/ui/presets';
import { figure, targetWithUnit, UNIT } from '@/ui/units';
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
import { offNotTaken } from '../rows';
import { scheduleTitle } from '../targets/schedule-words';
import { draftOf, equalsPreset, leafOffset, presetOf, vpdOf, withDraft, type LightSchedule, type TargetsDraft } from '../targets/targets-draft';
import {
  FIGURES,
  figureName,
  figureText,
  pendingByPath,
  pendingFigure,
  pendingMode,
  spellChangeOf,
  type FigureField,
  type PendingItem,
} from './figures';
import { LightCard, PlanMark } from './LightCard';
import { PendingNote } from './Pending';
import { PresetSheet } from './PresetSheet';
import { useSaved } from './saved';
import { FigureButton, ValueSheet } from './ValueSheet';
import styles from './Climate.module.css';
import ui from '@/ui/ui.module.css';

/**
 * What one device holds a place at: its light, and the targets by day and by
 * night - Steuerung's top for the place's climate, and the same two cards on
 * the page of any other device that holds targets of its own.
 *
 * Nothing here is a draft: a figure opens a sheet for that one figure, the
 * light's times and a preset have a sheet each, and every write is answered
 * by the toast. A device that is not heard is set all the same; what it has
 * not been handed is marked and said under the card by the server's own
 * reckoning (`pending`), never by a guess of the page's.
 *
 * With its control switched off the two cards stay, read as what holds once
 * it is on again: saving any of it switches the control on, which the sheet
 * says before the tap and the toast after it, and taking the save back
 * switches it off again.
 */

interface ClimateWrite {
  next: TargetsDraft;
  /** The preset taken, which says whether a drying spell or a germination starts or ends with it. */
  chip?: ClimateChoice | null;
  choices?: ChoiceValues;
  /** What holds, as the toast says it of a draft - the one saved and, taken back, the one before: "Temperatur am Tag 24,0 °C". */
  says: (draft: TargetsDraft) => string;
}

type Open = { kind: 'figure'; field: FigureField } | { kind: 'preset' } | null;

export function Climate({ device: read, stored, mayManage }: { device: Device; stored: DeviceConfiguration; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const plan = useDevicePlan(read.id);
  const liveRead = useDeviceLive(read.id);
  const save = useSaveConfiguration();
  const configure = useConfigure(read.id);
  const saved = useSaved(read);
  const move = usePlanTransition(read.id);
  const humidifier = useHumidifier(read);
  const heard = useHeardAt(read);
  const spoke = useLiveReads([read.id]).measuredAt.get(read.id) ?? heard;
  const [open, setOpen] = useState<Open>(null);
  // The stage the grow standing here is in, as the server names it: the alarm rules of that stage are grouped under the same name.
  const grow = useSpaceOverview(read.spaceId ?? '', read.spaceId !== null).data?.grows?.[0] ?? null;

  const pending = pendingByPath(liveRead.data?.pending);
  // Switched off while it was not heard, a device goes on holding what it was last handed: the cards stay as it runs them.
  const off = offNotTaken(read, pending);
  // Switched off and told so, the cards stay too - as what it holds once it is on again.
  const switchedOff = !off && read.control?.running === false && read.type !== 'fan';
  const device: Device = (off || switchedOff) && read.control ? { ...read, control: { ...read.control, running: true } } : read;
  const offset = offsetOf(now, zone);
  const isOffline = saved.offline;
  const offline = isOffline ? offlineLabel(spoke, now, zone, true) : null;
  const baseline = draftOf(stored);
  const climateOnly = device.type === 'fan';
  const hasCo2 = hasCo2Sensor(device);
  const storedChoices = choicesOf(device);
  const shape = shapeOf(device, baseline, { climateOnly, humidified: humidifier && storedChoices.humidifierHolds });
  const regime = shape.regime;
  // Nothing holds now while the control is off, so no column is marked as the one in force.
  const holding = nowHoldingOf({
    device: switchedOff ? read : device,
    shape: switchedOff ? { regime: 'off', greenhouse: shape.greenhouse } : shape,
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
  const busy = save.isPending || move.isPending || configure.isPending;
  const refused = save.error ?? move.error ?? configure.error;

  /** Whether writing `next` puts back by hand what the running plan's step writes, so the plan has to pause first. */
  const pausesFor = (next: TargetsDraft, chip: ClimateChoice | null = null, choices?: ChoiceValues): boolean => {
    const spell = spellChangeOf(chip, device, 'drying') !== null || spellChangeOf(chip, device, 'germination') !== null;
    const choicesMoved = choices !== undefined && (step?.germinationChoices ?? null) !== null;
    return status === 'running' && (spell || choicesMoved || changedFields(next, baseline).some(field => owned.has(field)));
  };

  const write = async ({ next, chip = null, choices, says }: ClimateWrite): Promise<boolean> => {
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
    // Saving what the device holds brings a control that was switched off back on; its way back switches it off again.
    const also = pauses
      ? { now: t('control.saved.planPaused'), back: t('control.saved.planGoesOn') }
      : switchedOff
        ? { now: t('control.saved.controlOn'), back: t('control.saved.controlOff') }
        : undefined;

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
      const resume = async () => {
        if (pauses) await move.mutateAsync({ kind: 'resume' });
        if (switchedOff) await configure.mutateAsync({ control: false });
      };
      // Into the document as it stands at the tap, so a setting saved since stays as it is.
      const put = async (figures: Partial<TargetsDraft>, extra: { germination?: boolean; germinationChoices?: Partial<ChoiceValues> } = {}) => {
        const current = (await readConfiguration(device.id)) ?? answer.configuration;
        return save.mutateAsync({
          deviceId: device.id,
          configuration: withDraft(current, { ...draftOf(current), ...figures }, climateOnly),
          ...extra,
        });
      };
      const before = Object.fromEntries(moved.map(field => [field, baseline[field]]));
      const kept = device.control?.afterGermination;
      // What one tap takes back: the figures this save moved, and nothing else. A drying spell keeps and returns
      // more than figures. Germination ended is begun again in two writes, since the dark keeps the day it finds
      // and the night it replaces: the night germination had kept in the light, then germination with its own.
      // A humidifier's rested band is not kept across that, so there is no way back then.
      const undo =
        dryingChange !== null || (germinationChange === null && choices !== undefined)
          ? null
          : germinationChange === 'starts'
            ? () => put(before, { germination: false }).then(resume)
            : germinationChange === null
              ? () => put(before).then(resume)
              : humidifier && !storedChoices.humidifierHolds
                ? null
                : async () => {
                    await put({
                      ...before,
                      nightTemperature: kept?.nightTemperature ?? baseline.nightTemperature,
                      nightHumidity: kept?.nightHumidity ?? baseline.nightHumidity,
                    });
                    await put(
                      { ...before, nightTemperature: baseline.nightTemperature, nightHumidity: baseline.nightHumidity },
                      { germination: true, germinationChoices: choicesSaid(storedChoices, humidifier) },
                    );
                    await resume();
                  };
      const undone = chip ? t('log.asBefore', { what: t('targets.title') }) : says(baseline);
      saved.say(says(next), undo && { undo, undone }, chip ? 'preset' : moved.join(' '), also);
      return true;
    } catch {
      // Said under the control that asked, from the write that was refused.
      return false;
    }
  };

  /** Ends a drying spell or a germination with no new climate: the server puts back what the spell wrote over, and a running plan would begin it again. */
  const endSpell = async (spell: 'drying' | 'germination'): Promise<boolean> => {
    try {
      if (status === 'running') await move.mutateAsync({ kind: 'pause', reason: t('targets.pauseReason') });
      await configure.mutateAsync(spell === 'drying' ? { drying: false } : { mode: 'standard' });
      saved.say(t(`control.preset.ended.${spell}`), null, 'preset');
      return true;
    } catch {
      return false;
    }
  };

  if (plan.isPending) return <Waiting lines={4} />;
  // Whether a save has to pause a plan first is not guessed at: a plan that could not be read is a card that cannot be drawn yet.
  if (!plan.data && !isMissing(plan.error)) return <LoadFailed retry={() => void plan.refetch()} />;

  const halves = halvesOf(regime);
  const preset = CLIMATE_CHOICES.find(chip => chosenBy(chip, baseline, shape, hasCo2, climateOnly)) ?? null;
  // The button names the preset the figures are. One figure set by hand later it still names what the server knows the
  // place is on: the spell the device runs, else the stage of the grow standing here.
  const spell = regime === 'drying' || regime === 'germination' ? regime : null;
  const staged = grow?.stage && writesClimate(grow.stage) && grow.stage !== 'drying' && grow.stage !== 'germination' ? grow : null;
  const named: ClimateChoice | null =
    preset ?? (spell ? { stage: spell, preset: null } : staged?.stage ? { stage: staged.stage, preset: staged.preset } : null);
  const rows = [
    { key: 'temperature', label: t('targets.table.temperature'), fields: { day: 'dayTemperature', night: 'nightTemperature' } },
    ...(holdsHumidity(shape)
      ? [{ key: 'humidity', label: t('targets.table.humidity'), fields: { day: 'dayHumidity', night: 'nightHumidity' } }]
      : []),
    ...(hasDay(regime) && hasCo2 ? [{ key: 'co2', label: t('targets.table.co2'), fields: { day: 'co2', night: null } }] : []),
  ] as { key: string; label: string; fields: Record<Half, FigureField | null> }[];
  const shown = rows.flatMap(row => halves.flatMap(half => (row.fields[half] ? [row.fields[half]] : [])));
  const mode = off ? null : pendingMode(t, device, pending);
  const waiting: PendingItem[] = [
    // A mode stored for a silent device changes what this card shows, while the device still runs the mode it had.
    ...(mode ? [mode] : []),
    ...shown.flatMap(field => {
      const held = pendingFigure(pending, field);
      return held
        ? [
            {
              name: figureName(t, field, regime),
              value: figureText(field, baseline[field]),
              held: typeof held.held === 'number' ? figureText(field, held.held) : null,
              savedAt: held.savedAt,
            },
          ]
        : [];
    }),
  ];

  return (
    <>
      <RefreshFailed failedAt={plan.isError && plan.data ? plan.dataUpdatedAt : null} now={now} />
      {off ? <ControlOff device={read} mayManage={mayManage} storedAt={off.savedAt} /> : null}
      {switchedOff ? <ControlOff device={read} mayManage={mayManage} /> : null}
      {/* Said once for both cards: what they hold is what holds once it is on again. */}
      {switchedOff ? <p className={styles.note}>{t('climateControl.cardsWhenOn')}</p> : null}

      {regime === 'sensor' ? null : (
        <LightCard
          device={device}
          stored={stored}
          shape={shape}
          baseline={baseline}
          now={now}
          offset={offset}
          holding={holding}
          offline={offline}
          pending={pending}
          owned={owned}
          plan={status === 'running' ? { name: planName, sets: planScheduleOf(step, baseline) } : null}
          switchesOn={switchedOff}
          mayManage={mayManage}
          busy={busy}
          error={refused}
          pauses={next => (pausesFor(next) ? planName : null)}
          onTimes={next => write({ next, says: draft => scheduleTitle(t, draft, offset) })}
          onLimit={value =>
            write({
              next: { ...baseline, lightLimit: value },
              says: draft => `${t('targets.aria.lightLimit')} ${figureText('lightLimit', draft.lightLimit)}`,
            })
          }
        />
      )}

      <section className={`${ui.panel} ${styles.card}`} aria-labelledby={`targets-${device.id}`}>
        <div className={styles.line}>
          <h2 className={`${ui.cardHeading} ${styles.title}`} id={`targets-${device.id}`}>
            {t('targets.title')}
          </h2>
          {mayManage ? (
            <button type="button" className={styles.pillButton} onClick={() => setOpen({ kind: 'preset' })}>
              {named ? t('control.preset.named', { name: climateChoiceName(t, named) }) : t('control.preset.open')}
            </button>
          ) : null}
        </div>

        <div
          className={`${ui.stack2} ${styles.grid}`}
          role="table"
          aria-label={t('targets.table.label')}
          data-single={halves.length === 1 || undefined}
        >
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
                return (
                  <span role="cell" key={half} className={field ? undefined : styles.none}>
                    {field ? (
                      <FigureButton
                        name={figureName(t, field, regime)}
                        text={figureText(field, baseline[field])}
                        pending={pendingFigure(pending, field) !== undefined}
                        onOpen={mayManage ? () => setOpen({ kind: 'figure', field }) : null}
                      />
                    ) : (
                      t('targets.table.co2Night')
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
            <PlanMark legend /> {t('targets.planTable.legend', { name: planName })}
          </p>
        ) : null}
        <Kept shape={shape} baseline={baseline} hasCo2={hasCo2} />
        <PendingNote items={waiting} />
      </section>

      {open?.kind === 'figure' ? (
        <FigureSheet
          key={open.field}
          device={device}
          field={open.field}
          regime={regime}
          baseline={baseline}
          pauses={next => (pausesFor(next) ? planName : null)}
          switchesOn={switchedOff}
          busy={busy}
          error={refused}
          onSave={next => write({ next, says: draft => `${figureName(t, open.field, regime)} ${figureText(open.field, draft[open.field])}` })}
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
          runs={status === 'running' ? planName : null}
          switchesOn={switchedOff}
          busy={busy}
          error={refused}
          onSave={(next, chip, choices, label) => write({ next, chip, choices, says: () => label })}
          onEnd={endSpell}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/**
 * One target, changed by itself: the stepper, the VPD a temperature or a
 * humidity makes with its partner, and - where a running plan writes this
 * figure - that saving pauses the plan, said before the tap.
 */
function FigureSheet({
  device,
  field,
  regime,
  baseline,
  pauses,
  switchesOn,
  busy,
  error,
  onSave,
  onClose,
}: {
  device: Device;
  field: FigureField;
  regime: Regime;
  baseline: TargetsDraft;
  pauses: (next: TargetsDraft) => string | null;
  /** The control is switched off, and saving switches it on. */
  switchesOn: boolean;
  busy: boolean;
  error: Error | null;
  onSave: (next: TargetsDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { metric, half, min, max, step, decimals } = FIGURES[field];
  const name = figureName(t, field, regime);
  const withValue = (value: number): TargetsDraft => ({ ...baseline, [field]: value });

  return (
    <ValueSheet
      title={name}
      figures={[{ key: field, label: name, value: baseline[field], min, max, step, decimals, unit: metric === 'light' ? '%' : (UNIT[metric] ?? '') }]}
      busy={busy}
      error={error}
      onSave={values => onSave(withValue(values[field]))}
      onClose={onClose}
    >
      {values => {
        const next = withValue(values[field]);
        const paused = pauses(next);
        // A figure refused for its range makes no VPD worth reading.
        const held = values[field] >= min && values[field] <= max;
        return (
          <>
            {held && half && (metric === 'temperature' || metric === 'humidity') ? (
              <p className={styles.derived}>
                <Term topic="vpd">{t('targets.table.vpd', { value: vpdText(device, next, half) })}</Term>
              </p>
            ) : null}
            {paused ? (
              <p className={styles.warn} role="status">
                {t('targets.planTable.pauses', { name: paused })}
              </p>
            ) : null}
            {switchesOn ? <p className={styles.note}>{t('climateControl.saveSwitchesOn')}</p> : null}
          </>
        );
      }}
    </ValueSheet>
  );
}

/**
 * What the grid leaves out, said under it: the half a regime of one column
 * keeps for later - the night at 24 hours of light, the day at none. What a
 * spell gives back when it ends is said where it is ended, in the preset sheet.
 */
function Kept({ shape, baseline, hasCo2 }: { shape: Shape; baseline: TargetsDraft; hasCo2: boolean }) {
  const { t } = useTranslation();
  const pair = (temperature: number, humidity: number) =>
    [targetWithUnit(temperature, 'temperature'), holdsHumidity(shape) ? targetWithUnit(humidity, 'humidity') : null].filter(
      (part): part is string => part !== null,
    );
  const kept =
    shape.regime === 'always'
      ? { summary: t('targets.table.keptNight'), parts: pair(baseline.nightTemperature, baseline.nightHumidity) }
      : shape.regime === 'never'
        ? {
            summary: t('targets.table.keptDay'),
            parts: [
              ...pair(baseline.dayTemperature, baseline.dayHumidity),
              ...(hasCo2 ? [`CO₂ ${targetWithUnit(baseline.co2, 'co2')}`] : []),
              t('targets.table.keptLight', { percent: Math.round(baseline.lightLimit) }),
            ],
          }
        : null;

  return kept ? (
    <p className={styles.note}>
      {kept.summary}: <Facts facts={kept.parts} />
    </p>
  ) : null;
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

const vpdText = (device: Device, draft: TargetsDraft, half: Half): string =>
  figure(
    vpdOf(
      half === 'day' ? draft.dayTemperature : draft.nightTemperature,
      half === 'day' ? draft.dayHumidity : draft.nightHumidity,
      leafOffset(device.settings, half),
    ),
    'vpd',
  );

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
