import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Plan, PlanNotify, StepDuration } from '@fg2/shared-types/v1';
import { isMissing, useDevicePlan, usePlanTransition, useStopPlan } from '@/api/plans';
import { ageAttribute, ageLabel, deviceLiveness } from '@/ui/age';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { PlanEditor } from './PlanEditor';
import { KeepAsTemplateSheet, StartFromTemplateSheet } from './PlanTemplates';
import { PlanRefusal } from './Refusal';
import {
  activeStep,
  countdownLabel,
  DURATION_UNITS,
  elapsedMs,
  isOpenEnded,
  isWaiting,
  leftMs,
  movesOf,
  nextStepIndex,
  overdueMs,
  spanLabel,
  throughStep,
} from './plan-clock';
import { draftOf, emptyDraft, type PlanDraft } from './plan-edit';
import { durationLabel, stepMeta } from './plan-labels';
import styles from './Control.module.css';

/**
 * What one controller is being run by, and the five moves that can be made to
 * it.
 *
 * The plan moves on the engine's clock: a step whose time is up is advanced
 * twenty seconds later whether or not this screen is open, so everything here
 * is drawn from the state the server last answered and the instants in it -
 * never from a status this screen decided. What the tent is actually holding is
 * a separate question again, and the line that says when the step last reached
 * the controller is dimmed by how long the controller has been quiet, because a
 * device that says nothing may have been running something else for an hour.
 *
 * A step writes a climate and nothing else, so hardware with nowhere for one to
 * land - a plug, a lamp - is told that rather than offered a plan: `holdsClimate`
 * is the same question the Manual targets page one tap below asks, and the two
 * screens used to answer it differently about the same tent. A plan that is
 * already on such a device is still drawn in full, because a plan nobody can see
 * is a plan nobody can stop.
 */
export function PlanPanel({ device, mayManage, holdsClimate }: { device: Device; mayManage: boolean; holdsClimate: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const plan = useDevicePlan(device.id);
  const [editing, setEditing] = useState<PlanDraft | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [picking, setPicking] = useState(false);

  const name = device.name ?? t(`devices.type.${device.type}`, { defaultValue: device.type });
  const title = (
    <span className="label">
      {t('space.control.title')} · {name}
    </span>
  );

  if (plan.isPending) {
    return (
      <section className={styles.panel}>
        {title}
        <Waiting lines={3} />
      </section>
    );
  }

  // A device that is being run by nothing is a fact about it rather than a
  // failure, and it is the one state this screen is offering to change.
  if (!plan.data) {
    return (
      <section className={styles.panel}>
        {title}
        {isMissing(plan.error) ? (
          <div className={`${ui.cardDashed} ${styles.none}`}>
            <p className={styles.noneWhat}>{t(holdsClimate ? 'space.control.none' : 'space.control.noClimate')}</p>
            <p className={ui.note}>{t(holdsClimate ? 'space.control.noneNote' : 'space.control.noClimateNote')}</p>
            {mayManage && holdsClimate ? (
              <div className={styles.actions}>
                <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => setEditing(emptyDraft(name, DEFAULT_NOTIFY))}>
                  {t('space.control.write')}
                </button>
                <button type="button" className={ui.button} onClick={() => setPicking(true)}>
                  {t('space.control.fromTemplate')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <LoadFailed retry={() => void plan.refetch()} />
        )}

        {editing ? <PlanEditor device={device} plan={null} draft={editing} onClose={() => setEditing(null)} /> : null}
        {picking ? (
          <StartFromTemplateSheet
            notify={DEFAULT_NOTIFY}
            onClose={() => setPicking(false)}
            onChosen={draft => {
              setPicking(false);
              setEditing(draft);
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      {title}
      <RefreshFailed failedAt={plan.isError ? plan.dataUpdatedAt : null} now={now} />

      {/* A plan that is already on hardware with no climate is shown whole, so
          it can be looked at and stopped, with the fact said once above it: the
          steps are writing a climate into a document that states none. */}
      {holdsClimate ? null : <p className={`${ui.cardDashed} ${ui.note}`}>{t('space.control.noClimateHasPlan')}</p>}

      <div className={`${ui.card} ${styles.plan}`}>
        <Standing plan={plan.data} device={device} now={now} />
        {mayManage ? <Moves plan={plan.data} device={device} now={now} onRefresh={() => void plan.refetch()} /> : null}
      </div>

      <Steps plan={plan.data} now={now} />

      {mayManage ? (
        <div className={styles.actions}>
          <button type="button" className={ui.button} onClick={() => setEditing(draftOf(plan.data))}>
            {t('space.control.edit')}
          </button>
          <button type="button" className={ui.button} onClick={() => setKeeping(true)}>
            {t('space.control.keepAsTemplate')}
          </button>
          {/* Editing stays, because emptying the steps is how a plan that should
              never have been written here is taken off. Starting a fresh one
              from a template would only write the same climate again. */}
          {holdsClimate ? (
            <button type="button" className={ui.button} onClick={() => setPicking(true)}>
              {t('space.control.fromTemplate')}
            </button>
          ) : null}
        </div>
      ) : null}

      {editing ? <PlanEditor device={device} plan={plan.data} draft={editing} onClose={() => setEditing(null)} /> : null}
      {keeping ? <KeepAsTemplateSheet plan={plan.data} onClose={() => setKeeping(false)} /> : null}
      {picking ? (
        <StartFromTemplateSheet
          notify={plan.data.notify}
          onClose={() => setPicking(false)}
          onChosen={draft => {
            setPicking(false);
            setEditing(draft);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * What a plan written here notifies by default: no mail until somebody asks for
 * one, and a diary line at every step, because a tent that changed what it holds
 * is exactly what a diary is read for.
 */
const DEFAULT_NOTIFY: PlanNotify = { mode: 'off', email: null, writeEntries: true };

/**
 * Where the plan stands: which step, how long it has been there, what follows,
 * and - when the step is one somebody has to answer - that it is standing still
 * until they do.
 */
function Standing({ plan, device, now }: { plan: Plan; device: Device; now: DateTime }) {
  const { t } = useTranslation();
  const step = activeStep(plan);
  const waiting = isWaiting(plan, now);
  const left = leftMs(plan, now);
  const through = throughStep(plan, now);
  const next = nextStepIndex(plan);
  const liveness = deviceLiveness(device.state.lastSeenAt, now);
  // A plan at rest has no clock, so it is not given one: the step it stands at
  // is where starting it would begin, and a bar filling up beside a tent that
  // is being run by nothing would be the screen inventing a state.
  const going = plan.state.status === 'running' || plan.state.status === 'paused';

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.planName}>{plan.name}</h2>
        <span className={`mono ${styles.status}`} data-status={plan.state.status}>
          {t(`space.control.status.${plan.state.status}`)}
        </span>
      </header>

      {step ? (
        <>
          <p className={styles.stepLine}>
            <span className={`mono ${styles.stepNumber}`}>
              {t('space.control.stepOf', { number: plan.state.activeStepIndex + 1, count: plan.steps.length })}
            </span>
            <span className={styles.stepName}>{step.name}</span>
          </p>
          <p className={`mono ${styles.stepMeta}`}>{stepMeta(t, step)}</p>

          {through === null || !going ? null : (
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ width: `${Math.round(through * 100)}%` }} data-status={plan.state.status} />
            </span>
          )}

          {going ? (
            <p className={`mono ${styles.clock}`}>
              {t('space.control.served', { age: spanLabel(elapsedMs(plan.state, now)) })}
              {isOpenEnded(step.duration)
                ? ` · ${t('space.control.openEnded')}`
                : left !== null
                  ? ` · ${t('space.control.left', { age: countdownLabel(left) })}`
                  : ` · ${t('space.control.over')}`}
            </p>
          ) : null}
        </>
      ) : (
        <p className={ui.note}>{t('space.control.noSteps')}</p>
      )}

      {waiting && step ? (
        <div className={`${ui.cardDashed} ${styles.waiting}`} role="status">
          <span className="label">{t('space.control.waiting.title')}</span>
          <p className={styles.waitingWhat}>{step.confirmationMessage || t('space.control.waiting.noMessage')}</p>
          <p className={ui.note}>{t('space.control.waiting.since', { age: spanLabel(overdueMs(plan, now) ?? 0) })}</p>
        </div>
      ) : null}

      <p className={ui.note}>
        {plan.state.status !== 'running' && plan.state.status !== 'paused'
          ? t(plan.state.status === 'completed' ? 'space.control.next.completed' : 'space.control.next.atRest')
          : next === null
            ? t('space.control.next.ends')
            : next === 0
              ? t('space.control.next.loops', { name: plan.steps[0]?.name ?? '' })
              : t('space.control.next.step', { number: next + 1, name: plan.steps[next]?.name ?? '' })}
      </p>

      {plan.state.status === 'paused' && plan.state.pauseReason ? (
        <p className={ui.note}>{t('space.control.pausedFor', { reason: plan.state.pauseReason })}</p>
      ) : null}

      <p className={`mono ${styles.applied}`} {...ageAttribute(liveness)}>
        {plan.state.lastAppliedAt
          ? t('space.control.applied.at', { age: ageLabel(plan.state.lastAppliedAt, now) })
          : t(going ? 'space.control.applied.never' : 'space.control.applied.atRest')}
        {liveness === 'offline' ? ` · ${t('space.control.applied.quiet', { age: ageLabel(device.state.lastSeenAt, now) })}` : ''}
      </p>
    </>
  );
}

/**
 * The five moves and the stop, each offered only where the server would take
 * it. Skipping and stopping say what they will do before they do it, in the
 * place where the tap would be - the same two-step the rest of the app asks a
 * question in - because neither of them can be taken back afterwards.
 */
function Moves({ plan, device, now, onRefresh }: { plan: Plan; device: Device; now: DateTime; onRefresh: () => void }) {
  const { t } = useTranslation();
  const move = usePlanTransition(device.id);
  const stop = useStopPlan(device.id);
  const [asking, setAsking] = useState<'skip' | 'stop' | 'extend' | null>(null);
  const [by, setBy] = useState<StepDuration>({ value: 1, unit: 'days' });

  const can = movesOf(plan, now);
  const next = nextStepIndex(plan);
  const busy = move.isPending || stop.isPending;
  const close = () => setAsking(null);

  return (
    <div className={styles.moves}>
      <div className={styles.actions}>
        {can.confirm ? (
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => move.mutate({ kind: 'confirm' })}>
            {t('space.control.move.confirm')}
          </button>
        ) : null}
        {can.resume ? (
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={busy} onClick={() => move.mutate({ kind: 'resume' })}>
            {t(plan.state.status === 'paused' ? 'space.control.move.resume' : 'space.control.move.start')}
          </button>
        ) : null}
        {can.pause ? (
          <button type="button" className={ui.button} disabled={busy} onClick={() => move.mutate({ kind: 'pause', reason: null })}>
            {t('space.control.move.pause')}
          </button>
        ) : null}
        {can.extend ? (
          <button type="button" className={ui.button} disabled={busy} onClick={() => setAsking(asking === 'extend' ? null : 'extend')}>
            {t('space.control.move.extend')}
          </button>
        ) : null}
        {can.skip ? (
          <button type="button" className={ui.button} disabled={busy} onClick={() => setAsking(asking === 'skip' ? null : 'skip')}>
            {t('space.control.move.skip')}
          </button>
        ) : null}
        {can.stop ? (
          <button
            type="button"
            className={`${ui.button} ${styles.danger}`}
            disabled={busy}
            onClick={() => setAsking(asking === 'stop' ? null : 'stop')}
          >
            {t('space.control.move.stop')}
          </button>
        ) : null}
      </div>

      {asking === 'extend' ? (
        <div className={styles.asking}>
          <p className={ui.note}>{t('space.control.ask.extend')}</p>
          <div className={styles.duration}>
            <input
              className={`${ui.input} ${styles.number}`}
              type="number"
              min={1}
              value={by.value}
              aria-label={t('space.control.step.durationValue')}
              onChange={event => setBy({ ...by, value: Math.max(1, Number(event.target.value) || 1) })}
            />
            <Choices label={t('space.control.step.durationUnit')}>
              {DURATION_UNITS.map(unit => (
                <Choice key={unit} chosen={by.unit === unit} onChoose={() => setBy({ ...by, unit })}>
                  {t(`space.control.unitName.${unit}`)}
                </Choice>
              ))}
            </Choices>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={busy}
              onClick={() => move.mutate({ kind: 'extend', by }, { onSuccess: close })}
            >
              {t('space.control.ask.extendYes', { length: durationLabel(t, by) })}
            </button>
            <button type="button" className={ui.button} onClick={close}>
              {t('grow.lifecycle.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {asking === 'skip' ? (
        <div className={styles.asking}>
          <p className={ui.note}>
            {next === null ? t('space.control.ask.skipEnds') : t('space.control.ask.skip', { number: next + 1, name: plan.steps[next]?.name ?? '' })}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={busy}
              onClick={() => move.mutate({ kind: 'skip' }, { onSuccess: close })}
            >
              {t('space.control.ask.skipYes')}
            </button>
            <button type="button" className={ui.button} onClick={close}>
              {t('grow.lifecycle.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {asking === 'stop' ? (
        <div className={styles.asking}>
          <p className={ui.note}>{t('space.control.ask.stop')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${styles.dangerButton}`}
              disabled={busy}
              onClick={() => stop.mutate(undefined, { onSuccess: close })}
            >
              {t('space.control.ask.stopYes')}
            </button>
            <button type="button" className={ui.button} onClick={close}>
              {t('grow.lifecycle.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <PlanRefusal error={move.error ?? stop.error} onRefresh={onRefresh} />
    </div>
  );
}

/** Every step in order, with the one the device is standing on marked as the one it is. */
function Steps({ plan, now }: { plan: Plan; now: DateTime }) {
  const { t } = useTranslation();
  const running = plan.state.status === 'running' || plan.state.status === 'paused';

  if (plan.steps.length === 0) return null;

  return (
    <ol className={styles.steps}>
      {plan.steps.map((step, index) => {
        const active = running && index === plan.state.activeStepIndex;
        // A step that is standing still is marked as that rather than as
        // running, and carries the colour the card above it carries.
        const how = isWaiting(plan, now) ? 'waiting' : plan.state.status;

        return (
          <li key={step.id} className={styles.step} data-active={active} data-status={active ? how : undefined}>
            <span className={`mono ${styles.stepIndex}`}>{index + 1}</span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>{step.name}</span>
              <span className={`mono ${styles.stepNote}`}>{stepMeta(t, step)}</span>
            </span>
            {active ? (
              <span className={`mono ${styles.here}`} data-status={how}>
                {how === 'waiting' ? t('space.control.waiting.short') : t(`space.control.status.${plan.state.status}`)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
