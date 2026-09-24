import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, GrowthStage, Plan, PlanNotifyMode } from '@fg2/shared-types/v1';
import { useSavePlan } from '@/api/plans';
import { Sheet } from '@/log/Sheet';
import { awaitingClimate, hasCo2Sensor } from '@/ui/climate-hardware';
import { Help } from '@/ui/Help';
import { presetsOf } from '@/ui/presets';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import { STAGES } from '@/ui/stages';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { DURATION_UNITS } from './plan-clock';
import {
  asWritableBy,
  editEffect,
  figuresFor,
  figureOf,
  moveStep,
  newStep,
  otherSections,
  replaceBody,
  withFigure,
  writesNothing,
  type Figure,
  type PlanDraft,
  type PlanEditEffect,
  type StepDraft,
} from './plan-edit';
import { stepMeta } from './plan-labels';
import { PlanRefusal } from './Refusal';
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
 */
export function PlanEditor({ device, plan, draft: opened, onClose }: { device: Device; plan: Plan | null; draft: PlanDraft; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useNow();
  const save = useSavePlan(device.id);
  // The draft is taken as this controller could run it: a figure its hardware
  // is known to throw away is dropped on the way in, so what the fields show is
  // what a save would write.
  const [draft, setDraft] = useState<PlanDraft>(() => asWritableBy(opened, device));
  /** One step is open at a time: two editors would be two answers to what is being written. */
  const [open, setOpen] = useState<string | null>(opened.steps.length === 1 ? opened.steps[0].key : null);

  const effect = plan ? editEffect(plan, draft.steps, now) : null;
  const steps = (next: StepDraft[]) => setDraft(current => ({ ...current, steps: next }));
  const change = (key: string, over: Partial<StepDraft>) => steps(draft.steps.map(step => (step.key === key ? { ...step, ...over } : step)));

  const add = () => {
    const step = newStep(t('space.control.step.defaultName', { number: draft.steps.length + 1 }));
    steps([...draft.steps, step]);
    setOpen(step.key);
  };

  return (
    <Sheet title={t(plan ? 'space.control.editor.title' : 'space.control.editor.newTitle')} onClose={onClose}>
      <div className={styles.editor}>
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
          <Toggle
            label={t('space.control.editor.loop')}
            note={t('space.control.editor.loopNote')}
            on={draft.loop}
            onToggle={loop => setDraft({ ...draft, loop })}
          />
        </Block>

        <Block
          label={t('space.control.editor.steps')}
          aside={<span className="mono">{t('space.control.editor.stepCount', { count: draft.steps.length })}</span>}
        >
          {draft.steps.length === 0 ? <p className={ui.note}>{t('space.control.editor.noSteps')}</p> : null}

          <ol className={ui.group}>
            {draft.steps.map((step, index) => (
              <li key={step.key} className={styles.editStep}>
                <div className={styles.editHead}>
                  <span className={`mono ${styles.stepIndex}`}>{index + 1}</span>
                  <span className={styles.stepText}>
                    <span className={styles.stepTitle}>{step.name}</span>
                    <span className={`mono ${styles.stepNote}`}>{stepMeta(t, step)}</span>
                  </span>
                  <span className={styles.editButtons}>
                    <button
                      type="button"
                      className={styles.icon}
                      aria-label={t('space.control.step.up', { name: step.name })}
                      disabled={index === 0}
                      onClick={() => steps(moveStep(draft.steps, index, -1))}
                    >
                      <ChevronUp size={16} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={styles.icon}
                      aria-label={t('space.control.step.down', { name: step.name })}
                      disabled={index === draft.steps.length - 1}
                      onClick={() => steps(moveStep(draft.steps, index, 1))}
                    >
                      <ChevronDown size={16} strokeWidth={2} aria-hidden />
                    </button>
                    <button type="button" className={ui.chip} onClick={() => setOpen(open === step.key ? null : step.key)}>
                      {t(open === step.key ? 'space.control.step.close' : 'space.control.step.open')}
                    </button>
                    <button
                      type="button"
                      className={`${ui.chip} ${styles.danger}`}
                      onClick={() => steps(draft.steps.filter(one => one.key !== step.key))}
                    >
                      {t('space.control.step.remove')}
                    </button>
                  </span>
                </div>

                {open === step.key ? <StepFields step={step} device={device} onChange={over => change(step.key, over)} /> : null}
              </li>
            ))}
          </ol>

          <button type="button" className={ui.button} onClick={add}>
            + {t('space.control.step.add')}
          </button>
        </Block>

        <Notify draft={draft} onChange={notify => setDraft({ ...draft, notify })} />

        {effect ? <Effect effect={effect} /> : <p className={ui.note}>{t('space.control.effect.newPlan')}</p>}
        <PlanRefusal error={save.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={save.isPending}
          onClick={() => save.mutate(replaceBody(draft), { onSuccess: () => onClose() })}
        >
          {save.isPending ? t('grow.lifecycle.saving') : t('space.control.editor.save')}
        </button>
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
function StepFields({ step, device, onChange }: { step: StepDraft; device: Device; onChange: (over: Partial<StepDraft>) => void }) {
  const { t } = useTranslation();
  const presets = step.stage ? presetsOf(step.stage) : [];
  const extra = otherSections(step.settings);
  const awaiting = awaitingClimate(device);

  const pickStage = (stage: GrowthStage | null) => {
    // A preset refines the stage it belongs to, so it does not survive a change of stage.
    const keep = stage !== null && presetsOf(stage).includes(step.preset ?? '');
    onChange({ stage, preset: keep ? step.preset : null });
  };

  return (
    <div className={styles.fields}>
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
            {t(`home.stage.${stage}`)}
          </Choice>
        ))}
      </Choices>
      <p className={ui.note}>{t('space.control.step.stageNote')}</p>

      {presets.length > 0 ? (
        <Choices label={t('space.control.step.preset')}>
          <Choice chosen={step.preset === null} onChoose={() => onChange({ preset: null })}>
            {t('grow.lifecycle.phase.noPreset')}
          </Choice>
          {presets.map(preset => (
            <Choice key={preset} chosen={step.preset === preset} onChoose={() => onChange({ preset })}>
              {t(`grow.presetName.${preset}`, { defaultValue: preset })}
            </Choice>
          ))}
          <Help topic="stepPreset" />
        </Choices>
      ) : null}

      <span className="label">{t('space.control.step.duration')}</span>
      <div className={styles.duration}>
        <input
          className={`${ui.input} ${styles.number}`}
          type="number"
          min={0}
          // Not whole numbers only: a recipe written before the rewrite may hold
          // half a day on a step, and a browser that calls that invalid would
          // put a red ring around a length the tent is actually running.
          step="any"
          value={step.duration.value}
          aria-label={t('space.control.step.durationValue')}
          onChange={event => onChange({ duration: { ...step.duration, value: Math.max(0, Number(event.target.value) || 0) } })}
        />
        <Choices label={t('space.control.step.durationUnit')}>
          {DURATION_UNITS.map(unit => (
            <Choice key={unit} chosen={step.duration.unit === unit} onChoose={() => onChange({ duration: { ...step.duration, unit } })}>
              {t(`space.control.unitName.${unit}`)}
            </Choice>
          ))}
        </Choices>
      </div>
      {step.duration.value <= 0 ? <p className={ui.note}>{t('space.control.step.openEndedNote')}</p> : null}

      <span className="label">{t('space.control.step.settings')}</span>
      <div className={styles.figures}>
        {figuresFor(device).map(figure => (
          <FigureField key={figure.key} figure={figure} step={step} device={device} onChange={onChange} />
        ))}
        {/* The figure this controller cannot run keeps its place and says what
            it needs, rather than leaving a gap that reads as a screen that
            forgot it. It is the row the manual targets page draws, in the same
            words. */}
        {hasCo2Sensor(device) ? null : (
          <span className={styles.figure}>
            <span className={styles.figureLabel}>{t('space.control.figure.co2')}</span>
            <span className={`mono ${styles.figureNeeds}`}>{t('targets.needsCo2')}</span>
          </span>
        )}
      </div>
      <p className={ui.note}>
        {writesNothing(step.settings)
          ? t('space.control.step.writesNothing')
          : awaiting
            ? t('space.control.step.writesNowhere')
            : t(hasCo2Sensor(device) ? 'space.control.step.writesSections' : 'space.control.step.writesSectionsNoCo2')}
      </p>
      {extra.length > 0 ? <p className={ui.note}>{t('space.control.step.alsoWrites', { sections: extra.join(', ') })}</p> : null}
      {device.configuration ? (
        <button type="button" className={ui.button} onClick={() => onChange({ settings: fromController(step, device) })}>
          {t('space.control.step.takeFromController')}
        </button>
      ) : null}

      <Toggle
        label={t('space.control.step.waits')}
        note={t('space.control.step.waitsNote')}
        on={step.waitForConfirmation}
        onToggle={waitForConfirmation => onChange({ waitForConfirmation })}
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

/** The figures of the step's settings as the controller states them now, for a step that should hold what the tent already holds. */
const fromController = (step: StepDraft, device: Device) =>
  figuresFor(device).reduce(
    (settings, figure) => withFigure(settings, figure, figureOf(device.configuration ?? {}, figure), device.configuration),
    step.settings,
  );

/** One climate figure. Empty is a figure this step does not write, which is not the same as zero. */
function FigureField({
  figure,
  step,
  device,
  onChange,
}: {
  figure: Figure;
  step: StepDraft;
  device: Device;
  onChange: (over: Partial<StepDraft>) => void;
}) {
  const { t } = useTranslation();
  const value = figureOf(step.settings, figure);

  return (
    <label className={styles.figure}>
      <span className={styles.figureLabel}>{t(`space.control.figure.${figure.key}`)}</span>
      <input
        className={`mono ${styles.figureInput}`}
        type="number"
        inputMode="decimal"
        placeholder="—"
        value={value ?? ''}
        onChange={event =>
          onChange({
            settings: withFigure(step.settings, figure, event.target.value === '' ? null : Number(event.target.value), device.configuration),
          })
        }
      />
      <span className={`mono ${styles.figureUnit}`}>{t(`space.control.figureUnit.${figure.key}`)}</span>
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

      <Toggle
        label={t('space.control.notify.writeEntries')}
        note={t('space.control.notify.writeEntriesNote')}
        on={draft.notify.writeEntries}
        onToggle={writeEntries => onChange({ ...draft.notify, writeEntries })}
      />
    </Block>
  );
}

/** A switch with what it means beside it, which is the app's own control and not a second one. */
function Toggle({ label, note, on, onToggle }: { label: string; note?: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className={styles.toggle}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {note ? <span className={ui.note}>{note}</span> : null}
      </span>
      <button type="button" className={ui.switch} role="switch" aria-checked={on} aria-label={label} onClick={() => onToggle(!on)}>
        <span className={ui.knob} aria-hidden />
      </button>
    </div>
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
    <ul className={styles.effect}>
      {lines.map(line => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
