import type { DateTime } from 'luxon';
import { Announce } from '@/ui/Announce';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Plan, PlanNotify, StepDuration } from '@fg2/shared-types/v1';
import { useDevices, useHeardAt } from '@/api/devices';
import { useGrows } from '@/api/grows';
import { isMissing, planMoved, useDevicePlan, usePlanTemplates, usePlanTransition, useRemovePlan, useStopPlan } from '@/api/plans';
import { useLog, type Back } from '@/log/log-context';
import { ageAttribute, ageLabel, deviceLiveness, offlineLabel } from '@/ui/age';
import type { ClimateLanding } from '@/ui/climate-hardware';
import { Asking } from '@/ui/Asking';
import { Help } from '@/ui/Help';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { serverNow } from '@/api/clock';
import { useNow } from '@/ui/useNow';
import { offsetOf } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { deviceName, deviceTitle } from '@/ui/naming';
import { alsoIn } from '@/screens/space/movable-grows';
import { ContinuePlan } from './ContinuePlan';
import { DurationField, PlanEditor } from './PlanEditor';
import { KeepAsTemplateSheet, StartFromTemplateSheet } from './PlanTemplates';
import { PlanRefusal } from './Refusal';
import {
  activeStep,
  countdownLabel,
  elapsedMs,
  isGoing,
  isOpenEnded,
  isWaiting,
  leftMs,
  movesOf,
  nextStepIndex,
  overdueMs,
  readingAt,
  spanLabel,
  startsInMs,
  throughStep,
} from './plan-clock';
import { draftOf, durationFits, emptyDraft, type PlanDraft } from './plan-edit';
import { offersReadyPlans } from './ready-plans';
import { followsGermination, ownStepName, pauseReasonOf, stepLengthLabel, stepMeta, stepTitle, usePlanWords } from './plan-labels';
import styles from './Control.module.css';

/**
 * What one device is being run by, and the moves that can be made to it.
 *
 * The plan moves on the engine's clock whether or not this screen is open, so
 * everything here is drawn from the state the server last answered and the
 * instants in it.
 *
 * A step writes a climate and nothing else, so where that climate would land
 * (`climateLanding`) decides what the panel offers. A plan on a device with
 * nowhere for one to go is still drawn in full: a plan nobody can see is a
 * plan nobody can stop.
 */
export function PlanPanel({ device, mayManage, landing }: { device: Device; mayManage: boolean; landing: ClimateLanding }) {
  const { t } = useTranslation();
  const plan = useDevicePlan(device.id);
  usePlanWords([plan.data]);
  const all = useDevices();
  // The beat re-renders the panel, and the reading is taken at the render: a
  // clock read up to a beat before the answer arrived puts a plan that was just
  // started in the panel's future, which is how an extension looks.
  useNow();
  const now = plan.data ? readingAt(plan.data.state, serverNow()) : serverNow();
  const [editing, setEditing] = useState<PlanDraft | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [picking, setPicking] = useState(false);
  const templates = usePlanTemplates();
  const ready = offersReadyPlans(device);
  const anyTemplate = templates.data?.items.length !== 0 || ready;

  const name = deviceName(device, t);
  const sheets = (
    <>
      {editing ? <PlanEditor device={device} plan={plan.data ?? null} draft={editing} onClose={() => setEditing(null)} /> : null}
      {keeping && plan.data ? <KeepAsTemplateSheet plan={plan.data} onClose={() => setKeeping(false)} /> : null}
      {picking ? (
        <StartFromTemplateSheet
          device={device}
          notify={plan.data?.notify ?? DEFAULT_NOTIFY}
          onClose={() => setPicking(false)}
          onChosen={draft => {
            setPicking(false);
            setEditing(draft);
          }}
        />
      ) : null}
    </>
  );

  if (plan.isPending) {
    return (
      <section className={ui.stack3}>
        <Waiting lines={3} />
      </section>
    );
  }

  // A device that is being run by nothing is a fact about it rather than a
  // failure, and it is the one state this screen is offering to change.
  if (!plan.data) {
    return (
      <section className={ui.stack3}>
        {isMissing(plan.error) ? (
          <div className={`${ui.cardDashed} ${ui.stack2}`}>
            <p className={styles.noneWhat}>
              {t('space.control.none')}
              <Help topic="plan" />
            </p>
            {landing === 'awaited' ? (
              <p className={ui.note}>
                {t('targets.waiting', {
                  device: deviceTitle(
                    device,
                    t,
                    all.data?.items.filter(other => other.spaceId === device.spaceId),
                  ),
                })}
              </p>
            ) : null}
            {mayManage && landing === 'document' ? (
              <div className={ui.wrap}>
                {/* A fridge starts where a beginner starts: from one of the two ready plans. */}
                {ready ? (
                  <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => setPicking(true)}>
                    {t('readyPlans.start')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`${ui.button} ${ready ? '' : ui.primary}`}
                  onClick={() => setEditing(emptyDraft(name, DEFAULT_NOTIFY))}
                >
                  {t('space.control.write')}
                </button>
                {anyTemplate && !ready ? (
                  <button type="button" className={ui.button} onClick={() => setPicking(true)}>
                    {t('space.control.template.startTitle')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <LoadFailed read={plan} />
        )}

        {sheets}
      </section>
    );
  }

  return (
    <section className={ui.stack3}>
      <RefreshFailed failedAt={plan.isError ? plan.dataUpdatedAt : null} now={now} />

      {/* Why this plan writes nothing: which of the two reasons it is, since only one of them is anybody's to change. */}
      {landing === 'document' ? null : (
        <p className={`${ui.cardDashed} ${ui.note}`}>
          {t(landing === 'awaited' ? 'space.control.waitingHasPlan' : 'space.control.noClimateHasPlan')}
        </p>
      )}

      <div className={`${ui.card} ${ui.stack2}`}>
        <Standing plan={plan.data} device={device} now={now} />
        {mayManage ? <Moves plan={plan.data} device={device} now={now} onRefresh={() => void plan.refetch()} /> : null}
      </div>

      <Steps plan={plan.data} now={now} />
      {mayManage && landing === 'document' ? <ContinuePlan device={device} /> : null}

      {mayManage ? (
        <div className={ui.wrap}>
          <button type="button" className={ui.button} onClick={() => setEditing(draftOf(plan.data))}>
            {t('space.control.edit')}
          </button>
          <button type="button" className={ui.button} onClick={() => setKeeping(true)}>
            {t('space.control.template.keepTitle')}
          </button>
          {/* Editing stays where no climate lands - emptying the steps is how such a plan is taken off - but no fresh one is started. */}
          {landing === 'document' && anyTemplate ? (
            <button type="button" className={ui.button} onClick={() => setPicking(true)}>
              {t('space.control.template.startTitle')}
            </button>
          ) : null}
        </div>
      ) : null}

      {sheets}
    </section>
  );
}

/** What a plan written here notifies by default: no mail until somebody asks, and a diary line at every step. */
const DEFAULT_NOTIFY: PlanNotify = { mode: 'off', email: null, writeEntries: true };

/** Where the plan stands: which step, for how long, what follows - and that it stands still until somebody answers. */
function Standing({ plan, device, now }: { plan: Plan; device: Device; now: DateTime }) {
  const { t } = useTranslation();
  const step = activeStep(plan);
  const waiting = isWaiting(plan, now);
  const left = leftMs(plan, now);
  // An extension moves the step's clock forward: until it begins the line says when the counting starts, not a figure
  // it would have to make up.
  const ahead = startsInMs(plan.state, now);
  const through = throughStep(plan, now);
  const next = nextStepIndex(plan);
  const heard = useHeardAt(device);
  const liveness = deviceLiveness(heard, now);
  const zone = useZone();
  // A plan at rest has no clock and is given none; one that has run every step stands at none of them.
  const going = isGoing(plan.state);

  return (
    <>
      <header className={ui.headRow}>
        <h2 className={styles.planName}>
          {plan.name}
          <Help topic="plan" />
        </h2>
        <span className={styles.status} data-status={plan.state.status}>
          {t(`space.control.status.${plan.state.status}`)}
        </span>
      </header>
      {/* A pause, a skip or a confirmation is said: the button pressed may be gone, and the page changes silently. */}
      <p className={ui.visuallyHidden} role="status">
        {[
          t(`space.control.status.${plan.state.status}`),
          plan.state.status !== 'completed' && step
            ? `${t('space.control.stepOf', { number: plan.state.activeStepIndex + 1, count: plan.steps.length })}${ownStepName(step.name, plan.state.activeStepIndex)}`
            : null,
        ]
          .filter(Boolean)
          .join(', ')}
      </p>

      {plan.state.status === 'completed' ? null : step ? (
        <>
          <p className={styles.stepLine}>
            <span className={styles.stepNumber}>
              {t('space.control.stepOf', { number: plan.state.activeStepIndex + 1, count: plan.steps.length })}
            </span>
            {/* A step whose name is its number is said once, by the number. */}
            {ownStepName(step.name, plan.state.activeStepIndex) ? <span className={styles.stepName}>{step.name}</span> : null}
          </p>
          <p className={styles.stepMeta}>
            {stepMeta(t, step, offsetOf(serverNow(), zone), followsGermination(plan.steps, plan.state.activeStepIndex, plan.loop))}
          </p>

          {through === null || !going ? null : (
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ width: `${Math.round(through * 100)}%` }} data-status={plan.state.status} />
            </span>
          )}

          {going ? (
            <p className={`mono ${styles.clock}`}>
              {ahead === null
                ? t('space.control.served', { age: spanLabel(elapsedMs(plan.state, now)) })
                : t(plan.state.status === 'paused' ? 'space.control.extendedPausedClock' : 'space.control.extendedClock', {
                    age: countdownLabel(ahead),
                  })}
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
        // The age in it ticks, so it is said once, as it starts waiting, rather than as a live region.
        <div className={`${ui.cardDashed} ${styles.waiting}`}>
          <Announce text={t('space.control.waiting.title')} />
          <span className="label">{t('space.control.waiting.title')}</span>
          <p className={styles.waitingWhat}>{step.confirmationMessage || t('space.control.waiting.noMessage')}</p>
          <p className={ui.note}>{t('space.control.waiting.since', { age: spanLabel(overdueMs(plan, now) ?? 0) })}</p>
        </div>
      ) : null}

      <p className={ui.note}>
        {!going
          ? t(plan.state.status === 'completed' ? 'space.control.next.completed' : 'space.control.next.atRest')
          : next === null
            ? t('space.control.next.ends')
            : t(next === 0 ? 'space.control.next.loops' : 'space.control.next.step', {
                number: next + 1,
                name: ownStepName(plan.steps[next]?.name ?? '', next),
              })}
      </p>

      {plan.state.status === 'paused' && plan.state.pauseReason ? (
        <p className={ui.note}>{t('space.control.pausedFor', { reason: pauseReasonOf(t, plan.state.pauseReason) })}</p>
      ) : null}

      {/* What the device last heard from the plan. A going plan without `lastAppliedAt` owes its step - the engine
          clears it to send the step within its next pass. A plan at rest writes nothing, whether it ever ran or not,
          which the line about what follows says. */}
      {going ? (
        <p className={styles.applied} {...ageAttribute(liveness)}>
          {plan.state.lastAppliedAt
            ? t('space.control.applied.at', { age: ageLabel(plan.state.lastAppliedAt, now) })
            : t('space.control.applied.never')}
          {liveness === 'offline' ? ` · ${t('space.control.applied.quiet', { offline: offlineLabel(heard, now, zone) })}` : ''}
        </p>
      ) : null}
    </>
  );
}

/**
 * The five moves and the stop, each offered only where the server would take
 * it. Skipping and stopping ask first, where the tap would be: neither can be
 * taken back. So does going on while the device's regulation is off: the step
 * it sends switches it back on, which is said before and after.
 */
function Moves({ plan, device, now, onRefresh }: { plan: Plan; device: Device; now: DateTime; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const client = useQueryClient();
  const move = usePlanTransition(device.id);
  const stop = useStopPlan(device.id);
  const remove = useRemovePlan(device.id);
  const [asking, setAsking] = useState<'skip' | 'stop' | 'extend' | 'remove' | 'resume' | null>(null);
  const [by, setBy] = useState<StepDuration>({ value: 1, unit: 'days' });
  const switchedOff = device.control?.running === false;

  const can = movesOf(plan, now);
  const next = nextStepIndex(plan);
  // Starting moves a grow standing here into the step's stage: said only where one stands.
  const growsHere = alsoIn(useGrows(device.spaceId !== null).data?.items, device.spaceId, undefined).length > 0;
  const startStage = growsHere ? (activeStep(plan)?.stage ?? null) : null;
  const busy = move.isPending || stop.isPending || remove.isPending;
  const close = () => setAsking(null);
  /**
   * What a move did, said once it has landed: the button that asked may be gone with it. Only a pause is taken back
   * whole - continuing sends the step's figures again, and every other move starts or ends something.
   */
  const said = (what: string, params: Record<string, unknown> = {}) => t(`space.control.told.${what}`, { plan: plan.name, ...params });
  const told = (what: string, params: Record<string, unknown> = {}, back: Back | { undo: null } = { undo: null }) => {
    close();
    tell({ label: said(what, params), ...back, from: `plan-${device.id}` });
  };
  const stepName = (index: number | null) => (index === null ? '' : stepTitle(t, plan.steps[index]?.name ?? '', index));
  const paused = plan.state.status === 'paused';
  // Going on sends the step, which switches regulation back on: the device is read again, so Steuerung says it is on.
  const resume = () =>
    move.mutate(
      { kind: 'resume' },
      {
        onSuccess: () => {
          if (switchedOff) void planMoved(client);
          told(paused ? (switchedOff ? 'resumedOn' : 'resumed') : switchedOff ? 'startedOn' : 'started', {
            step: stepName(plan.state.activeStepIndex),
          });
        },
      },
    );

  return (
    <div className={styles.moves}>
      <div className={ui.wrap}>
        {can.confirm ? (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy}
            onClick={() =>
              move.mutate({ kind: 'confirm' }, { onSuccess: () => told(next === null ? 'confirmedLast' : 'confirmed', { step: stepName(next) }) })
            }
          >
            {t('space.control.move.confirm')}
          </button>
        ) : null}
        {can.resume ? (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy}
            onClick={() => (switchedOff ? setAsking(asking === 'resume' ? null : 'resume') : resume())}
          >
            {t(paused ? 'space.control.move.resume' : 'space.control.move.start')}
          </button>
        ) : null}
        {can.pause ? (
          <button
            type="button"
            className={ui.button}
            disabled={busy}
            onClick={() =>
              move.mutate(
                { kind: 'pause', reason: null },
                {
                  onSuccess: () =>
                    told(
                      'paused',
                      {},
                      { undo: () => move.mutateAsync({ kind: 'resume' }), undone: said('resumed', { step: stepName(plan.state.activeStepIndex) }) },
                    ),
                },
              )
            }
          >
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
          <button type="button" className={`${ui.button} ${ui.danger}`} disabled={busy} onClick={() => setAsking(asking === 'stop' ? null : 'stop')}>
            {t('space.control.move.stop')}
          </button>
        ) : null}
        {can.remove ? (
          <button
            type="button"
            className={`${ui.button} ${ui.danger}`}
            disabled={busy}
            onClick={() => setAsking(asking === 'remove' ? null : 'remove')}
          >
            {t('space.control.move.remove')}
          </button>
        ) : null}
        {can.resume || can.pause ? <Help topic="planMoves" /> : null}
      </div>

      {/* Starting puts the grow standing here into the stage the first step names: said before the tap. */}
      {can.resume && !paused && startStage ? (
        <p className={ui.note}>{t('space.control.startsStage', { stage: t(`home.stage.${startStage}`) })}</p>
      ) : null}

      {asking === 'resume' ? (
        <Asking
          note={t(paused ? 'space.control.ask.resumeOn' : 'space.control.ask.startOn', { plan: plan.name })}
          yes={t(paused ? 'space.control.ask.resumeOnYes' : 'space.control.ask.startOnYes')}
          // The one filled green stays "Fortsetzen": what also switches regulation on is not the obvious tap.
          quiet
          busy={busy}
          onYes={resume}
          onCancel={close}
        />
      ) : null}

      {asking === 'extend' ? (
        <Asking
          note={t('space.control.ask.extend')}
          yes={t('space.control.ask.extendYes', { length: durationFits(by, 1) ? stepLengthLabel(t, by) : '…' })}
          busy={busy || !durationFits(by, 1)}
          onYes={() => move.mutate({ kind: 'extend', by }, { onSuccess: () => told('extended', { length: stepLengthLabel(t, by) }) })}
          onCancel={close}
        >
          <DurationField value={by} min={1} onChange={setBy} />
        </Asking>
      ) : null}

      {asking === 'skip' ? (
        <Asking
          note={
            next === null
              ? t('space.control.ask.skipEnds')
              : t(plan.state.status === 'paused' ? 'space.control.ask.skipPaused' : 'space.control.ask.skip', {
                  number: next + 1,
                  name: ownStepName(plan.steps[next]?.name ?? '', next),
                })
          }
          yes={t('space.control.ask.skipYes')}
          busy={busy}
          onYes={() => move.mutate({ kind: 'skip' }, { onSuccess: () => told(next === null ? 'skippedLast' : 'skipped', { step: stepName(next) }) })}
          onCancel={close}
        />
      ) : null}

      {asking === 'stop' ? (
        <Asking
          note={t('space.control.ask.stop')}
          yes={t('space.control.ask.stopYes')}
          danger
          busy={busy}
          onYes={() => stop.mutate(undefined, { onSuccess: () => told('stopped') })}
          onCancel={close}
        />
      ) : null}

      {asking === 'remove' ? (
        <Asking
          note={t('space.control.ask.remove')}
          yes={t('space.control.ask.removeYes')}
          danger
          busy={busy}
          onYes={() => remove.mutate(undefined, { onSuccess: () => told('removed') })}
          onCancel={close}
        />
      ) : null}

      <PlanRefusal error={move.error ?? stop.error ?? remove.error} onRefresh={onRefresh} />
    </div>
  );
}

/** Every step in order, with the one the device is standing on marked as the one it is. */
function Steps({ plan, now }: { plan: Plan; now: DateTime }) {
  const { t } = useTranslation();
  const zone = useZone();
  const offset = offsetOf(serverNow(), zone);
  const running = isGoing(plan.state);

  if (plan.steps.length === 0) return null;

  return (
    <ol className={ui.group}>
      {plan.steps.map((step, index) => {
        const active = running && index === plan.state.activeStepIndex;
        // A step that is standing still is marked as that rather than as
        // running, and carries the colour the card above it carries.
        const how = isWaiting(plan, now) ? 'waiting' : plan.state.status;

        return (
          <li key={step.id} className={styles.step} data-current={active ? (how === 'running' ? 'now' : 'held') : undefined}>
            <span className={`mono ${styles.stepIndex}`}>{index + 1}</span>
            <span className={`${ui.textColumn} ${styles.stepText}`}>
              <span className={styles.stepTitle}>{stepTitle(t, step.name, index)}</span>
              <span className={styles.stepNote}>{stepMeta(t, step, offset, followsGermination(plan.steps, index, plan.loop))}</span>
            </span>
            {active ? (
              <span className={styles.here} data-status={how}>
                {how === 'waiting' ? t('space.control.waiting.short') : t(`space.control.status.${plan.state.status}`)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
