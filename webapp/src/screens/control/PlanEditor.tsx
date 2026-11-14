import { ChevronDown, ChevronUp } from 'lucide-react';
import { Fragment, useId, useState } from 'react';
import { announce } from '@/ui/live-region';
import { Asking } from '@/ui/Asking';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfiguration, GrowthStage, Plan, PlanNotifyMode, StepDuration } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { useSavePlan } from '@/api/plans';
import { ApiError } from '@/api/problem';
import type { Translate } from '@/i18n/i18n';
import { looseFigure } from '@/ui/figures';
import { Sheet } from '@/ui/Sheet';
import { awaitingClimate, germinates, hasCo2Sensor } from '@/ui/climate-hardware';
import { StageClimates } from '@/screens/grow/ClimatePick';
import { Help } from '@/ui/Help';
import { keptPreset, presetsOf, stageChoiceName } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import { SwitchRow } from '@/ui/Switch';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { serverNow } from '@/api/clock';
import { GerminationChoices } from './germination/GerminationChoices';
import { choicesOf, useHumidifier } from './germination/germination-choices';
import { DURATION_UNITS } from './plan-clock';
import { scheduleTitle } from './targets/schedule-words';
import { draftOf as targetsOf } from './targets/targets-draft';
import {
  asWritableBy,
  CLIMATE_FIGURES,
  durationFits,
  editEffect,
  figuresFor,
  figuresRefused,
  figureOf,
  heldByStage,
  isDarkStage,
  LIGHT_HOURS,
  lightHoursFit,
  moveStep,
  newStep,
  NIGHT_HUMIDITY,
  otherSections,
  rangeOf,
  replaceBody,
  stepLightHours,
  stepLightsOn,
  storedSettings,
  withFigure,
  withoutStepLightsOn,
  withStepLightsOn,
  writesNothing,
  type Figure,
  type FigureRefused,
  type PlanDraft,
  type PlanEditEffect,
  type StepDraft,
} from './plan-edit';
import { followsGermination, stepMeta } from './plan-labels';
import { PlanRefusal } from './Refusal';
import { TimeInput } from './TimeInput';
import styles from './Control.module.css';

/**
 * Writing the recipe: the steps in the order the tent goes through them, what
 * each of them asks of the controller, and how long it asks for it.
 *
 * The whole plan is written at once, because that is what the route takes and
 * because a list that saved itself a row at a time would leave a tent halfway
 * between two recipes. What it costs is that a save has consequences for a tent
 * that is already running, and those are the sentences above the button: the
 * step the device is standing on is found again by its id, so inserting a step
 * above it moves the plan down the list with it and its clock carries on, while
 * removing that step leaves nothing to continue and the step standing at its
 * place starts from zero.
 *
 * Saving does not start anything. A plan that is at rest stays at rest, which
 * is the server's own rule and the reason "start" on the plan screen is a
 * resume.
 *
 * A figure outside the range Steuerung holds it to, a length the route cannot
 * take and light hours past a day are refused under their field and again
 * under the button they keep from saving - never pulled into the range, which
 * would write something nobody typed.
 */
export function PlanEditor({ device, plan, draft: opened, onClose }: { device: Device; plan: Plan | null; draft: PlanDraft; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const save = useSavePlan(device.id);
  // The draft is taken as this controller could run it: a figure its hardware
  // is known to throw away is dropped on the way in, so what the fields show is
  // what a save would write.
  const [draft, setDraft] = useState<PlanDraft>(() => asWritableBy(opened, device));
  /** One step is open at a time: two editors would be two answers to what is being written. */
  const [open, setOpen] = useState<string | null>(opened.steps.length === 1 ? opened.steps[0].key : null);
  const [first] = useState(() => JSON.stringify(asWritableBy(opened, device)));
  const [leaving, setLeaving] = useState(false);
  // Escape, the backdrop and × all close the sheet; with edits in it they ask first, since Escape is pressed out of habit.
  const close = () => (JSON.stringify(draft) === first ? onClose() : setLeaving(true));
  // The field still being typed in ("<step>:<figure>", "<step>:lightHours", "<step>:duration") is refused once it is
  // left or the plan saved, not on the "2" of a "26".
  const [typing, setTyping] = useState<string | null>(null);
  const typedIn = (step: StepDraft) => (typing?.startsWith(`${step.key}:`) ? typing.slice(step.key.length + 1) : null);
  const refusals = (settled: boolean) =>
    draft.steps.flatMap(step =>
      refusalsOf(t, step, device, storedSettings(plan, step), settled ? null : typedIn(step)).map(refusal =>
        t('space.control.editor.refusedIn', { step: step.name, refusal }),
      ),
    );
  const refused = refusals(false);
  const fits = refused.length === 0;
  const fromServer = serverRefusal(t, save.error, draft);

  const effect = plan ? editEffect(plan, draft.steps, now) : null;
  const steps = (next: StepDraft[]) => setDraft(current => ({ ...current, steps: next }));
  const change = (key: string, over: Partial<StepDraft>) => steps(draft.steps.map(step => (step.key === key ? { ...step, ...over } : step)));

  /** Moved and said where to, with the focus kept on the button that moved it, which the move takes along. */
  const move = (index: number, by: -1 | 1) => {
    const step = draft.steps[index];
    if (index + by < 0 || index + by >= draft.steps.length) return;
    steps(moveStep(draft.steps, index, by));
    announce(t('space.control.step.moved', { name: step.name, number: index + by + 1, count: draft.steps.length }));
    requestAnimationFrame(() => document.getElementById(`${step.key}-${by < 0 ? 'up' : 'down'}`)?.focus());
  };

  /** Removed at once, as it always was, and said; the focus goes to the step that took its place, or to adding one. */
  const remove = (index: number) => {
    const step = draft.steps[index];
    const next = draft.steps[index + 1] ?? draft.steps[index - 1];
    steps(draft.steps.filter(one => one.key !== step.key));
    announce(t('space.control.step.removed', { name: step.name }));
    requestAnimationFrame(() => document.getElementById(next ? `${next.key}-open` : 'plan-add-step')?.focus());
  };

  const add = () => {
    const step = newStep(t('space.control.step.defaultName', { number: draft.steps.length + 1 }));
    steps([...draft.steps, step]);
    setOpen(step.key);
  };

  return (
    <Sheet title={t(plan ? 'space.control.editor.title' : 'space.control.editor.newTitle')} onClose={close}>
      <div className={ui.sheetBody}>
        {leaving ? (
          <Asking
            note={t('space.control.editor.leave')}
            yes={t('targets.discard')}
            danger
            busy={false}
            onYes={onClose}
            onCancel={() => setLeaving(false)}
          />
        ) : null}
        <Block label={t('space.control.editor.plan')}>
          <label className="label" htmlFor="plan-name">
            {t('space.control.editor.name')}
          </label>
          <input
            id="plan-name"
            className={ui.input}
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
            autoComplete="off"
          />
          <SwitchRow
            label={t('space.control.editor.loop')}
            note={t('space.control.editor.loopNote')}
            on={draft.loop}
            onChange={loop => setDraft({ ...draft, loop })}
          />
        </Block>

        <Block label={t('space.control.editor.steps')} aside={t('space.control.editor.stepCount', { count: draft.steps.length })}>
          {draft.steps.length === 0 ? <p className={ui.note}>{t('space.control.editor.noSteps')}</p> : null}

          <ol className={ui.group}>
            {draft.steps.map((step, index) => (
              <li key={step.key} className={styles.editStep}>
                <div className={`${ui.row3} ${styles.editHead}`}>
                  <span className={`mono ${styles.stepIndex}`}>{index + 1}</span>
                  <span className={`${ui.textColumn} ${styles.stepText}`}>
                    <span className={styles.stepTitle}>{step.name}</span>
                    <span className={styles.stepNote}>
                      {stepMeta(t, step, offsetOf(now, zone), followsGermination(draft.steps, index, draft.loop))}
                    </span>
                  </span>
                  <span className={styles.editButtons}>
                    {/* At an end a move says so rather than being disabled, which would drop the focus moved onto it. */}
                    <button
                      type="button"
                      id={`${step.key}-up`}
                      className={styles.icon}
                      aria-label={t('space.control.step.up', { name: step.name })}
                      aria-disabled={index === 0 || undefined}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp size={16} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      id={`${step.key}-down`}
                      className={styles.icon}
                      aria-label={t('space.control.step.down', { name: step.name })}
                      aria-disabled={index === draft.steps.length - 1 || undefined}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown size={16} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      id={`${step.key}-open`}
                      className={ui.chip}
                      aria-expanded={open === step.key}
                      aria-controls={`${step.key}-fields`}
                      aria-label={t('space.control.step.openNamed', { name: step.name })}
                      onClick={() => setOpen(open === step.key ? null : step.key)}
                    >
                      {t(open === step.key ? 'space.control.step.close' : 'space.control.step.open')}
                    </button>
                    <button
                      type="button"
                      className={`${ui.chip} ${ui.danger}`}
                      aria-label={t('space.control.step.removeNamed', { name: step.name })}
                      onClick={() => remove(index)}
                    >
                      {t('space.control.step.remove')}
                    </button>
                  </span>
                </div>

                {open === step.key ? (
                  <StepFields
                    id={`${step.key}-fields`}
                    step={step}
                    stored={storedSettings(plan, step)}
                    device={device}
                    afterGermination={followsGermination(draft.steps, index, draft.loop)}
                    typing={typedIn(step)}
                    onTyping={field => setTyping(field === null ? null : `${step.key}:${field}`)}
                    onChange={over => change(step.key, over)}
                  />
                ) : null}
              </li>
            ))}
          </ol>

          <button type="button" id="plan-add-step" className={ui.button} onClick={add}>
            <span aria-hidden>+</span> {t('space.control.step.add')}
          </button>
        </Block>

        <Notify draft={draft} onChange={notify => setDraft({ ...draft, notify })} />

        {effect ? <Effect effect={effect} /> : <p className={ui.note}>{t('space.control.effect.newPlan')}</p>}
        {fromServer ? (
          <p className={ui.problem} role="alert">
            {fromServer}
          </p>
        ) : (
          <PlanRefusal error={save.error} />
        )}

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={save.isPending || !fits}
          aria-describedby={fits ? undefined : 'plan-save-why'}
          onClick={() => (refusals(true).length > 0 ? setTyping(null) : save.mutate(replaceBody(draft), { onSuccess: () => onClose() }))}
        >
          {save.isPending ? t('grow.lifecycle.saving') : t('space.control.editor.save')}
        </button>
        {/* The step that says why may be folded away; the reason stands under the button it keeps from saving. */}
        {fits ? null : (
          <div className={ui.stack1} id="plan-save-why">
            {refused.map(line => (
              <p key={line} className={ui.note}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * One step: what it is called, what it puts the grow into, how long it lasts and
 * what it holds the tent at.
 *
 * The figures stay editable for a controller whose settings have never arrived,
 * because clearing them is the only way a step that should never have been
 * written there is taken off - but what they would do is said above them rather
 * than left to be found out. The way in to a fresh plan for such a controller is
 * closed one screen up, so this is the plan somebody is taking off.
 */
function StepFields({
  id,
  step,
  stored,
  device,
  afterGermination,
  typing,
  onTyping,
  onChange,
}: {
  id: string;
  step: StepDraft;
  /** What the step carried as it was saved, whose figures are not held to their range again. */
  stored: DeviceConfiguration | null;
  device: Device;
  /** Whether the step follows a germination step, which it ends however little else it writes. */
  afterGermination: boolean;
  /** The field of the step still being typed in, which is not refused before it is left. */
  typing: string | null;
  onTyping: (field: string | null) => void;
  onChange: (over: Partial<StepDraft>) => void;
}) {
  const { t } = useTranslation();
  const extra = otherSections(step.settings);
  const awaiting = awaitingClimate(device);
  const humidifier = useHumidifier(device);
  // What a germination step does about the humidity: its own, or what the device does now until it says.
  const choices = step.germinationChoices ?? choicesOf(device);

  const pickStage = (stage: GrowthStage | null) => {
    // Drying and germination know no day, light or CO2: a step into either writes what it holds and nothing else.
    // A germination step says what it does about the humidity, starting from what the device does now.
    onChange({
      stage,
      // A preset refines the stage it belongs to, so it survives a change of stage only where the new one has it.
      preset: stage ? keptPreset(stage, step.preset) : null,
      germinationChoices: stage === 'germination' ? choices : null,
      ...heldByStage(step, stage),
    });
  };
  // Held round the clock in the dark: drying, or germination.
  const dark = isDarkStage(step.stage) ? (step.stage as 'drying' | 'germination') : null;
  const figures = figuresFor(device, step.stage);
  const refused = figuresRefused(step, device, stored).filter(one => one.figure.key !== typing);
  const rangeId = (figure: Figure) => `${id}-${figure.key}-range`;
  const pairOf = (figure: Figure) => Math.floor(figures.findIndex(one => one.key === figure.key) / 2);

  return (
    <div className={styles.fields} id={id}>
      <label className="label" htmlFor={`step-name-${step.key}`}>
        {t('space.control.step.name')}
      </label>
      <input
        id={`step-name-${step.key}`}
        className={ui.input}
        value={step.name}
        onChange={event => onChange({ name: event.target.value })}
        autoComplete="off"
      />

      <span className="label">
        {t('space.control.step.stage')}
        <Help topic="stage" />
      </span>
      <Choices label={t('space.control.step.stage')}>
        <Choice chosen={step.stage === null} onChoose={() => pickStage(null)}>
          {t('space.control.noStage')}
        </Choice>
        {STAGES.map(stage => (
          <Choice key={stage} chosen={step.stage === stage} onChoose={() => pickStage(stage)}>
            {stageChoiceName(t, stage)}
          </Choice>
        ))}
      </Choices>
      <p className={ui.note}>{t('space.control.step.stageNote')}</p>

      {step.stage && presetsOf(step.stage).length > 0 ? (
        <>
          <span className="label">
            {t('space.control.step.preset')}
            <Help topic="stepPreset" />
          </span>
          <StageClimates
            label={t('space.control.step.preset')}
            stage={step.stage}
            chosen={step.preset}
            onPick={preset => onChange({ preset })}
            keep
          />
        </>
      ) : null}

      <span className="label">{t('space.control.step.duration')}</span>
      <DurationField
        value={step.duration}
        min={0}
        fractional
        onTyping={typed => onTyping(typed ? 'duration' : null)}
        onChange={duration => onChange({ duration })}
      />
      {step.duration.value === 0 ? <p className={ui.note}>{t('space.control.step.openEndedNote')}</p> : null}

      <span className="label">
        {t('space.control.step.settings')}
        <Help topic="stepSettings" />
      </span>
      <div className={`${ui.halves} ${styles.figures}`}>
        {/* A figure out of its range is refused across the grid under the pair it stands in, so the day's two and
            the night's two stay side by side. */}
        {figures.map((figure, index) => {
          const said = index % 2 === 1 || index === figures.length - 1 ? refused.filter(one => pairOf(one.figure) === Math.floor(index / 2)) : [];
          return (
            <Fragment key={figure.key}>
              <FigureField
                figure={figure}
                step={step}
                onChange={onChange}
                held={dark}
                refusedBy={refused.some(one => one.figure.key === figure.key) ? rangeId(figure) : null}
                onTyping={onTyping}
              />
              {said.map(one => (
                <p key={one.figure.key} id={rangeId(one.figure)} className={`${ui.problem} ${styles.figureWide}`} role="alert">
                  {figureRefusal(t, one, dark)}
                </p>
              ))}
            </Fragment>
          );
        })}
        {/* A drying room and a germination are dark round the clock: they have no light hours to set. */}
        {dark ? null : <LightHoursField step={step} device={device} typing={typing === 'lightHours'} onTyping={onTyping} onChange={onChange} />}
        {/* The figure this controller cannot run keeps its place and says what
            it needs, rather than leaving a gap that reads as a screen that
            forgot it. It is the row the manual targets page draws, in the same
            words. */}
        {hasCo2Sensor(device) || dark ? null : (
          <span className={styles.figure}>
            <span className={styles.figureLabel}>{t('space.control.figure.co2')}</span>
            <span className={styles.figureNeeds}>{t('alarms.needs.co2')}</span>
          </span>
        )}
      </div>
      {dark ? <p className={ui.note}>{t(`space.control.step.${dark}Note`)}</p> : null}
      {step.stage === 'germination' ? (
        <GerminationChoices
          value={choices}
          onChange={change => onChange({ germinationChoices: { ...choices, ...change } })}
          humidifier={humidifier}
          // The humidity the step holds, or what the device goes on holding where it names none.
          humidity={
            figureOf(step.settings, NIGHT_HUMIDITY) ??
            (germinates(device) && device.configuration ? figureOf(device.configuration, NIGHT_HUMIDITY) : GERMINATION_HUMIDITY)
          }
        />
      ) : null}
      {/* A drying or germination step says what it writes in its own note above, by its stage alone if need be;
          the day, CO₂ and the light are not among it. */}
      {dark && !awaiting ? null : (
        <p className={ui.note}>
          {!dark && writesNothing(step.settings) && step.lightHours === null
            ? t(afterGermination ? 'space.control.step.endsGermination' : 'space.control.step.writesNothing')
            : awaiting
              ? t('space.control.step.writesNowhere')
              : t('space.control.step.writesSections')}
        </p>
      )}
      {extra.length > 0 ? <p className={ui.note}>{t('space.control.step.alsoWrites', { sections: extra.join(', ') })}</p> : null}
      {/* A germination step holds the temperature seeds sprout at. What a device
          holds with its light on is no such figure, so it is offered only by a
          device that germinates now. */}
      {device.configuration && (step.stage !== 'germination' || germinates(device)) ? (
        <button type="button" className={`${ui.button} ${styles.wraps}`} onClick={() => onChange(fromController(step, device))}>
          {t('space.control.step.takeFromController')}
        </button>
      ) : null}

      <SwitchRow
        label={t('space.control.step.waits')}
        note={t('space.control.step.waitsNote')}
        on={step.waitForConfirmation}
        onChange={waitForConfirmation => onChange({ waitForConfirmation })}
      />
      {step.waitForConfirmation ? (
        <input
          className={ui.input}
          value={step.confirmationMessage ?? ''}
          placeholder={t('space.control.step.messageHint')}
          aria-label={t('space.control.step.message')}
          onChange={event => onChange({ confirmationMessage: event.target.value || null })}
        />
      ) : null}
    </div>
  );
}

/**
 * The figures of the step's settings and its light hours as the controller
 * states them now, for a step that should hold what the tent already holds.
 */
const fromController = (step: StepDraft, device: Device): Partial<StepDraft> => {
  const configuration = device.configuration ?? {};
  const daynight = configuration.daynight as Record<string, unknown> | undefined;
  const statesLight = typeof daynight?.day === 'number' && typeof daynight?.night === 'number';

  return {
    settings: figuresFor(device, step.stage).reduce(
      (settings, figure) => withFigure(settings, figure, figureOf(configuration, figure)),
      step.settings,
    ),
    lightHours: statesLight && !isDarkStage(step.stage) ? Math.round(targetsOf(configuration).lightHours) : step.lightHours,
  };
};

/**
 * A length and its unit. A step may be open-ended at nought; anything else is at least one of its unit. What was
 * typed stays as typed: a length below `min`, or none that reads as a number, is refused under the field and handed
 * on as it is (`durationFits` says whether it can be sent), never pulled up to `min`.
 */
export function DurationField({
  value,
  min,
  fractional = false,
  onTyping,
  onChange,
}: {
  value: StepDuration;
  min: 0 | 1;
  /** Hears that a length is being typed, and that its field was left: a length is refused only then. */
  onTyping?: (typing: boolean) => void;
  /**
   * Whether a fraction stands, as it does on a step: a recipe migrated from the
   * old app may hold half a day on one, and a browser that calls that invalid
   * would put a red ring around a length the tent is actually running.
   */
  fractional?: boolean;
  onChange: (duration: StepDuration) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [typed, setTyped] = useState(() => String(value.value));
  const [typing, setTyping] = useState(false);
  const fits = durationFits(value, min) || typing;
  const typingIs = (now: boolean) => {
    setTyping(now);
    onTyping?.(now);
  };

  return (
    <div className={ui.stack1}>
      <div className={ui.wrapRow}>
        <input
          className={`${ui.input} ${styles.number}`}
          type="number"
          min={min}
          step={fractional ? 'any' : undefined}
          value={typed}
          aria-label={t('space.control.step.durationValue')}
          aria-invalid={fits ? undefined : true}
          aria-describedby={fits ? undefined : `${id}-range`}
          onChange={event => {
            setTyped(event.target.value);
            typingIs(true);
            onChange({ ...value, value: event.target.value.trim() === '' ? Number.NaN : Number(event.target.value) });
          }}
          onBlur={() => typingIs(false)}
        />
        <Choices label={t('space.control.step.durationUnit')}>
          {DURATION_UNITS.map(unit => (
            <Choice key={unit} chosen={value.unit === unit} onChoose={() => onChange({ ...value, unit })}>
              {t(`space.control.unitName.${unit}`)}
            </Choice>
          ))}
        </Choices>
      </div>
      {fits ? null : (
        <p id={`${id}-range`} className={ui.problem} role="alert">
          {t('space.control.step.durationRange', { min })}
        </p>
      )}
    </div>
  );
}

/**
 * How long the light is on while the step runs: what turns a vegetative tent
 * into a flowering one. The light keeps the hour it comes on, so the step says
 * hours and the window they make from the device's hour is written under them;
 * empty leaves the photoperiod as it is.
 *
 * A recipe migrated from the old app carries the hour too, as two fixed times
 * of day the engine sends every hour: its hours are those times' and its time
 * stands beside them to be moved, or handed back to the device so the hour set
 * under Zielwerte holds again.
 */
function LightHoursField({
  step,
  device,
  typing,
  onTyping,
  onChange,
}: {
  step: StepDraft;
  device: Device;
  /** Still being typed in, so not refused yet. */
  typing: boolean;
  onTyping: (field: string | null) => void;
  onChange: (over: Partial<StepDraft>) => void;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const id = `step-light-${step.key}`;
  const offset = offsetOf(serverNow(), zone);
  const own = stepLightsOn(step.settings);
  const hours = stepLightHours(step);
  const lightsOn = own ?? (device.configuration ? targetsOf(device.configuration).lightsOn : null);
  const outside = !lightHoursFit(step) && !typing;

  return (
    <>
      <span className={styles.figure}>
        <span className={styles.figureLabel}>
          <label htmlFor={id}>{t('planLight.label')}</label>
          <Help topic="stepLightHours" />
        </span>
        <input
          id={id}
          className={styles.figureInput}
          type="number"
          inputMode="numeric"
          min={LIGHT_HOURS.min}
          max={LIGHT_HOURS.max}
          step={1}
          placeholder="—"
          aria-invalid={outside || undefined}
          aria-describedby={outside ? `${id}-range` : undefined}
          value={hours ?? ''}
          onChange={event => {
            onTyping('lightHours');
            onChange({ lightHours: event.target.value === '' ? null : Number(event.target.value) });
          }}
          onBlur={() => onTyping(null)}
        />
        <span className={styles.figureUnit}>{t('planLight.unit')}</span>
      </span>
      {outside ? (
        <p className={`${ui.problem} ${styles.figureWide}`} role="alert" id={`${id}-range`}>
          {t('planLight.range', LIGHT_HOURS)}
        </p>
      ) : null}
      {own !== null ? (
        <span className={styles.figure}>
          <span className={styles.figureLabel}>
            <label htmlFor={`${id}-on`}>{t('planLight.lightsOn')}</label>
          </span>
          <TimeInput
            id={`${id}-on`}
            className={`${styles.figureInput} ${styles.figureClock}`}
            seconds={own}
            offset={offset}
            onChange={seconds => onChange(withStepLightsOn(step, seconds))}
          />
        </span>
      ) : null}
      {hours !== null && lightsOn !== null ? (
        <p className={`${ui.note} ${styles.figureWide}`}>
          {t(own !== null ? 'planLight.windowOwn' : 'planLight.windowDevice', {
            light: scheduleTitle(t, { lightsOn, lightHours: hours }, offset),
          })}
          {own !== null ? (
            <>
              {' '}
              <button type="button" className={ui.headLink} onClick={() => onChange(withoutStepLightsOn(step))}>
                {t('planLight.useDevice')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** One climate figure. Empty is a figure this step does not write, which is not the same as zero. */
function FigureField({
  figure,
  step,
  onChange,
  held = null,
  refusedBy,
  onTyping,
}: {
  figure: Figure;
  step: StepDraft;
  onChange: (over: Partial<StepDraft>) => void;
  /** A drying or germination step, whose night figures are what it holds round the clock and are named so. */
  held?: 'drying' | 'germination' | null;
  /** The id of the sentence that refuses the figure, where it lies outside its range. */
  refusedBy: string | null;
  onTyping: (field: string | null) => void;
}) {
  const { t } = useTranslation();
  const value = figureOf(step.settings, figure);
  const { min, max } = rangeOf(figure);

  return (
    <label className={styles.figure}>
      <span className={styles.figureLabel}>{figureLabel(t, figure, held)}</span>
      <input
        className={styles.figureInput}
        type="number"
        inputMode="decimal"
        placeholder="—"
        min={min}
        max={max}
        aria-invalid={refusedBy ? true : undefined}
        aria-describedby={refusedBy ?? undefined}
        value={value ?? ''}
        onChange={event => {
          onTyping(figure.key);
          onChange({ settings: withFigure(step.settings, figure, event.target.value === '' ? null : Number(event.target.value)) });
        }}
        onBlur={() => onTyping(null)}
      />
      <span className={styles.figureUnit}>{t(`space.control.figureUnit.${figure.key}`)}</span>
    </label>
  );
}

/** Where the plan writes when it moves on. The address is the one field somebody who may only look never sees, so it is only offered where it was answered. */
function Notify({ draft, onChange }: { draft: PlanDraft; onChange: (notify: PlanDraft['notify']) => void }) {
  const { t } = useTranslation();
  const modes: PlanNotifyMode[] = ['off', 'on_step', 'on_confirmation'];

  return (
    <Block label={t('space.control.notify.label')}>
      <Choices label={t('space.control.notify.label')}>
        {modes.map(mode => (
          <Choice key={mode} chosen={draft.notify.mode === mode} onChoose={() => onChange({ ...draft.notify, mode })}>
            {t(`space.control.notify.mode.${mode}`)}
          </Choice>
        ))}
      </Choices>

      {draft.notify.mode === 'off' ? null : (
        <>
          <input
            className={ui.input}
            type="email"
            value={draft.notify.email ?? ''}
            placeholder={t('space.control.notify.ownAddress')}
            aria-label={t('space.control.notify.email')}
            onChange={event => onChange({ ...draft.notify, email: event.target.value || null })}
          />
          <p className={ui.note}>{t('space.control.notify.emailNote')}</p>
        </>
      )}

      <SwitchRow
        label={t('space.control.notify.writeEntries')}
        note={t('space.control.notify.writeEntriesNote')}
        on={draft.notify.writeEntries}
        onChange={writeEntries => onChange({ ...draft.notify, writeEntries })}
      />
    </Block>
  );
}

/** What the save would do to the tent that is already being run by this plan, in the sentences it comes to. */
function Effect({ effect }: { effect: PlanEditEffect }) {
  const { t } = useTranslation();
  const lines: string[] = [];

  if (effect.atRest) lines.push(t('space.control.effect.atRest'));
  if (effect.empties) lines.push(t('space.control.effect.empties'));
  if (effect.keeps) {
    lines.push(
      effect.keeps.from === effect.keeps.to
        ? t('space.control.effect.stays', { name: effect.keeps.name, number: effect.keeps.to })
        : t('space.control.effect.moves', { name: effect.keeps.name, from: effect.keeps.from, to: effect.keeps.to }),
    );
    if (effect.keeps.relength) lines.push(t('space.control.effect.relength'));
  }
  if (effect.restarts)
    lines.push(t('space.control.effect.restarts', { gone: effect.restarts.gone, starts: effect.restarts.starts, number: effect.restarts.at }));
  if (effect.resends) lines.push(t('space.control.effect.resends'));

  return (
    <ul className={`${ui.effects} ${styles.effect}`}>
      {lines.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** What a step's figure is called: by the spell where the step holds one climate round the clock. */
const figureLabel = (t: Translate, figure: Figure, held: 'drying' | 'germination' | null): string =>
  t(held ? `space.control.figure.${held}.${figure.key}` : `space.control.figure.${figure.key}`);

/** "Tag · Temperatur: zwischen 15 und 35 °C, oder leer lassen." */
const figureRefusal = (t: Translate, refused: FigureRefused, held: 'drying' | 'germination' | null): string =>
  t('space.control.step.outOfRange', {
    name: figureLabel(t, refused.figure, held),
    low: looseFigure(refused.min),
    high: looseFigure(refused.max),
    unit: t(`space.control.figureUnit.${refused.figure.key}`),
  });

/** Everything that keeps a step from being saved, in the words its fields say it in. */
/** What keeps a step from being saved, in words; the field still being typed in (`typing`) is not judged yet. */
const refusalsOf = (t: Translate, step: StepDraft, device: Device, stored: DeviceConfiguration | null, typing: string | null): string[] => {
  const held = isDarkStage(step.stage) ? (step.stage as 'drying' | 'germination') : null;
  return [
    ...figuresRefused(step, device, stored)
      .filter(refused => refused.figure.key !== typing)
      .map(refused => figureRefusal(t, refused, held)),
    ...(lightHoursFit(step) || typing === 'lightHours' ? [] : [t('planLight.range', LIGHT_HOURS)]),
    ...(durationFits(step.duration, 0) || typing === 'duration' ? [] : [t('space.control.step.durationRange', { min: 0 })]),
  ];
};

/**
 * A save the server refused for one figure of one step, said in the words the field would have said it in: the
 * sheet refuses the same ranges first, so this is what an older page or a range moved on the server leaves.
 */
const serverRefusal = (t: Translate, error: unknown, draft: PlanDraft): string | null => {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return null;
  for (const { field } of error.problem.errors) {
    const match = /^steps[.[](\d+)\]?\.(.+)$/.exec(field);
    const step = match ? draft.steps[Number(match[1])] : undefined;
    if (!match || !step) continue;
    const path = match[2].replace(/^settings\./, '');
    const held = isDarkStage(step.stage) ? (step.stage as 'drying' | 'germination') : null;
    const figure = CLIMATE_FIGURES.find(one => `${one.section}.${one.field}` === path);
    const refusal = figure
      ? figureRefusal(t, { figure, ...rangeOf(figure) }, held)
      : path === 'lightHours'
        ? t('planLight.range', LIGHT_HOURS)
        : path.startsWith('duration')
          ? t('space.control.step.durationRange', { min: 0 })
          : null;
    if (refusal) return t('space.control.editor.refusedIn', { step: step.name, refusal });
  }
  return null;
};
