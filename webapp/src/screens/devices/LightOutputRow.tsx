import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns, SocketOverrideState } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSaveConfiguration, useSetOverride } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ageLabel } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { Fact, Facts } from './Facts';
import { LEVEL_STEP, percentLabel, withLightLimit, type LightOutput } from './lights';
import { defaultHold, durationLabel, holdsFor } from './sockets';
import styles from './Devices.module.css';
import { refusalText } from '@/ui/refusal';

interface LightOutputRowProps {
  output: LightOutput;
  /** Why the device would hear no command, or null. A level is not a command, so it is saved all the same. */
  unheard: string | null;
  mayManage: boolean;
  /** What the light output did in the last day, where the tent's verdict is already in hand. */
  runs: ActuatorRuns | null;
  now: DateTime;
}

/**
 * The controller's own light output: the one thing on this screen that runs at a
 * level rather than on or off.
 *
 * It is drawn as a dimmer and not as a switch, because that is what the hardware
 * is - a PWM channel the firmware caps at the brightness the configuration names
 * - and because the two halves of it reach the device by different roads. The
 * brightness is a setting: it is stored and handed to the controller, and a
 * controller that is asleep gets it when it wakes. Holding the output on or off
 * is a command: it is heard or it is not, it dies with a reboot, and a build
 * that has not announced it is never sent one.
 *
 * What the lamp is actually doing is a reading, and it is the only fact here the
 * device vouches for: a setting is never acknowledged and an override is never
 * reported, so the level above the dimmer is what the row is honest with.
 *
 * The brightness is a key of the same document a grow plan's steps are written
 * into, so this slider and a running plan are two hands on one figure: the
 * engine re-sends the step it stands on every hour, which would undo a
 * brightness set here without a word. The Manual targets page has always said
 * that before a save and paused the plan to make it true, and this row is the
 * quicker way to the same figure - so it asks the same question, says the same
 * sentence in the same amber, and pauses the same way. A row that did less would
 * be the shortcut that costs the grower their setting.
 */
export function LightOutputRow({ output, unheard, mayManage, runs, now }: LightOutputRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const override = useSetOverride();
  const save = useSaveConfiguration();
  const plan = useDevicePlan(output.deviceId);
  const move = usePlanTransition(output.deviceId);

  // A level is a reading and carries the verdict the server passed on it, so a
  // lamp nobody has heard from in ten minutes is dimmed and dated rather than
  // drawn as though it were still at that brightness - and one silent for four
  // days is still drawn, which is the whole of the rule.
  const measured = output.level;
  const freshness = measured?.state ?? 'offline';

  // What the slider stands at, and what was stored when it was dragged there.
  // A drag holds the slider until the stored document moves - so a save in
  // flight does not snap it back and a save that failed keeps showing what was
  // asked for, while a brightness somebody dialled in on the device itself
  // takes the slider over as soon as it arrives.
  const stored = output.limitPercent;
  const [draft, setDraft] = useState<{ percent: number; against: number | null } | null>(null);
  const dragged = draft !== null && draft.against === stored;
  const level = dragged ? draft.percent : (stored ?? 100);
  // A range input has to stand somewhere, so it stands at the top of its scale
  // where nothing is stored - but that position is the control's mechanics and
  // not a fact about the lamp, and printed beside it in the same weight as a
  // real 40 % it read as a ceiling the device was running at. So the figure is
  // said only once there is one to say, and the slider speaks the same words it
  // is drawn with. The panel behind the chevron has always said it this way.
  const stated = dragged || stored !== null ? percentLabel(level) : t('devices.lightOutput.noLimit');

  const cannotSetLevel = output.configuration === null ? t('devices.lightOutput.noSettings') : null;
  // Why the buttons are out of reach. The old build's refusal ends by pointing
  // at the brightness as the half that gets through anyway, which is the whole
  // of its comfort - and on a device that has sent no settings there is no
  // document to write a brightness into, so that half is a promise the line
  // above it has just withdrawn. The two notes stand one under the other, so a
  // reader met "there is nothing to write a brightness into" and "the
  // brightness still reaches it" in consecutive sentences. Where there is
  // nothing to send, the refusal says only that this build cannot be held.
  // A device type whose firmware holds no output on command in any build is
  // not waiting for an update, so it is not told to.
  const neverHolds = !SOCKET_HOST_TYPES.includes(output.type);
  const cannotForce = neverHolds
    ? t(cannotSetLevel ? 'devices.lightOutput.neverHoldsAlone' : 'devices.lightOutput.neverHolds')
    : !output.takesOverride
      ? t(cannotSetLevel ? 'devices.lightOutput.needsFirmwareAlone' : 'devices.lightOutput.needsFirmware')
      : unheard;
  // The buttons are drawn only where a hold could be asked for at all: beside a
  // build or a device that can never take one they were three words that looked
  // as pressable as any other choice, and the note under them already says why.
  const offersHold = !neverHolds && output.takesOverride;
  // "Nothing is listening" is true of the buttons and not of the slider, so a
  // device nobody can reach says the whole of it in one line rather than a
  // refusal beside a control that works.
  const why = cannotForce && unheard && !cannotSetLevel ? t('devices.lightOutput.keptForLater') : cannotForce;

  // Whether a plan is standing over this document is not something to guess at:
  // until the read lands the slider is left where it is, and a device that is
  // being run by nothing answers `plan_not_found`, which is a fact and not a
  // failure.
  const planStatus = plan.data?.state.status ?? null;
  const planUnread = plan.isPending || (!plan.data && !isMissing(plan.error));

  // Saving over a running plan pauses it first, exactly as the Manual targets
  // page does, because the engine would otherwise put the step's own brightness
  // back within the hour. Both errors are the mutations' own and are shown from
  // there.
  const commit = async () => {
    if (level === stored || !output.configuration || planUnread) return;

    try {
      if (planStatus === 'running') await move.mutateAsync({ kind: 'pause', reason: t('devices.lightOutput.pauseReason') });
      await save.mutateAsync({ deviceId: output.deviceId, configuration: withLightLimit(output.configuration, output.type, level) });
    } catch {
      // Said under the row, by whichever of the two refused.
    }
  };

  // How long ON and OFF hold the output for. A hold that says nothing about its
  // own end is the one thing the server refuses outright - `override_without_end`
  // - so the duration was always part of the command, and this row was the one
  // place that chose it for the grower in silence while the socket a few rows
  // down offered five. The chips behind the chevron move this; the row prints
  // it beside the buttons, so it is known before the tap and not only after it.
  //
  // The chips set the time rather than sending one, which is where they differ
  // from a socket's: a plug is on or off and a chip there means "the other way,
  // for this long", while this output runs at a level and has no other way to
  // be put. The direction is the three buttons' to say.
  const [hold, setHold] = useState(defaultHold());
  const [asked, setAsked] = useState<number | null>(null);

  const force = (state: SocketOverrideState) => {
    const forSeconds = state === 'auto' ? 0 : hold;
    setAsked(state === 'auto' ? null : forSeconds);
    override.mutate({ deviceId: output.deviceId, target: { kind: 'output', output: 'light' }, state, forSeconds });
  };

  return (
    <li className={`${ui.card} ${styles.socket}`}>
      <div className={styles.socketHead}>
        <Lightbulb className={styles.socketIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{t('devices.lightOutput.title')}</span>
          <span className={styles.rowNote}>{t('devices.lightOutput.is')}</span>
        </div>
        <span className={`mono ${styles.socketState}`} data-age={freshness}>
          {measured
            ? `${percentLabel(measured.percent)} · ${t('devices.ago', { age: ageLabel(measured.measuredAt, now) })}`
            : t('devices.lightOutput.noLevel')}
        </span>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={t('devices.socket.details', { name: t('devices.lightOutput.title') })}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={16} strokeWidth={2} aria-hidden /> : <ChevronRight size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>

      {mayManage ? (
        <div className={styles.dimmer}>
          <label className="label" htmlFor={`level-${output.deviceId}`}>
            {t('devices.lightOutput.brightness')}
          </label>
          {/* Nothing to write into is nothing to drag: a disabled slider still
              stood at the top of its scale, a level nobody had stated. */}
          {cannotSetLevel === null ? (
            <input
              id={`level-${output.deviceId}`}
              className={`${ui.range} ${styles.slider}`}
              style={{ '--filled': `${level}%` } as CSSProperties}
              type="range"
              min={0}
              max={100}
              step={LEVEL_STEP}
              value={level}
              aria-valuetext={stated}
              onChange={event => setDraft({ percent: Number(event.target.value), against: stored })}
              onPointerUp={() => void commit()}
              onKeyUp={() => void commit()}
              onBlur={() => void commit()}
            />
          ) : null}
          <span className={`mono ${styles.level}`}>{stated}</span>
          {/* The group carries the duration rather than each button, so the
              three keep the one-word names they are drawn with and a reader
              hears how long a hold lasts once, where the choice belongs. */}
          {offersHold ? (
            <span className={ui.segments} role="group" aria-label={t('devices.lightOutput.forceFor', { duration: durationLabel(hold) })}>
              {(['auto', 'on', 'off'] as const).map(state => (
                <button
                  key={state}
                  type="button"
                  className={`${ui.segment} ${styles.forceOption}`}
                  disabled={cannotForce !== null}
                  onClick={() => force(state)}
                >
                  {t(`devices.socket.${state}`)}
                </button>
              ))}
            </span>
          ) : null}
          {/* Only beside buttons that can be pressed: next to three greyed
              words it would be the length of a hold nobody can ask for. */}
          {cannotForce === null ? (
            <span className={`mono ${styles.holdLength}`}>{t('devices.lightOutput.holds', { duration: durationLabel(hold) })}</span>
          ) : null}
        </div>
      ) : null}

      {/* What a save costs, said before the drag rather than after it. The card
          is the amber the app keeps for a state somebody chose, and carries the
          way back out of it while the plan is standing still. */}
      {mayManage && !cannotSetLevel && planStatus === 'running' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="running" role="status">
          <p className={styles.planText}>{t('devices.lightOutput.planRunning')}</p>
        </div>
      ) : null}
      {mayManage && !cannotSetLevel && planStatus === 'paused' ? (
        <div className={`${ui.card} ${styles.planCard}`} data-status="paused" role="status">
          <p className={styles.planText}>{t('devices.lightOutput.planPaused')}</p>
          <button type="button" className={ui.button} disabled={move.isPending} onClick={() => move.mutate({ kind: 'resume' })}>
            {t('devices.lightOutput.resume')}
          </button>
        </div>
      ) : null}

      {mayManage && cannotSetLevel ? <p className={ui.note}>{cannotSetLevel}</p> : null}
      {mayManage && why ? <p className={ui.note}>{why}</p> : null}
      <Saved save={save} paused={move} />
      <Asked ask={override} heldFor={asked} />

      {open ? (
        <div className={styles.socketPanel}>
          <Facts>
            <Fact
              label={t('devices.lightOutput.setTo')}
              value={output.limitPercent === null ? t('devices.lightOutput.noLimit') : percentLabel(output.limitPercent)}
            />
            <Fact
              label={t('devices.lightOutput.running')}
              value={measured ? `${percentLabel(measured.percent)} · ${t('devices.ago', { age: ageLabel(measured.measuredAt, now) })}` : '—'}
            />
            {runs ? <Fact label={t('devices.socket.runs')} value={t('devices.socket.runsValue', { count: runs.runCount })} /> : null}
          </Facts>

          {/* The same times a smart socket is held for, because the firmware
              holds anything for any of them: the list is the override's own
              ceiling and neither the role nor the build narrows it. */}
          {mayManage ? (
            <div className={styles.holds}>
              <span className="label">{t('devices.socket.holdFor')}</span>
              {holdsFor().map(seconds => (
                <button
                  key={seconds}
                  type="button"
                  className={ui.chip}
                  aria-pressed={why === null && seconds === hold}
                  disabled={why !== null}
                  onClick={() => setHold(seconds)}
                >
                  {durationLabel(seconds)}
                </button>
              ))}
              {/* Why these are grey, where they are, rather than a scroll back
                  up the row: this is what somebody opened the panel to reach.
                  It is the row's own sentence and not the raw reason behind it,
                  so a device nobody is listening on does not say "your build is
                  too old" down here and "nothing is listening" up there. None of
                  the grey chips is drawn as the one in force, because no hold
                  can be asked for at all. */}
              {why ? <p className={`${ui.note} ${styles.whyGrey}`}>{why}</p> : null}
            </div>
          ) : null}

          <p className={ui.note}>{t('devices.lightOutput.explained')}</p>
        </div>
      ) : null}
    </li>
  );
}

type Mutation = { isPending: boolean; error: Error | null };

/**
 * What a saved brightness amounts to. The device acknowledges no setting at all,
 * so the line says it was stored and sent, and points at the level above - which
 * is the device's own word and the only one there is.
 *
 * The pause that goes before the save is drawn from here too, because a pause
 * the server refused means the brightness was never sent either: two lines under
 * one drag would leave it to the reader to work out which half happened.
 */
function Saved({ save, paused }: { save: Mutation & { isSuccess: boolean }; paused: Mutation }) {
  const { t } = useTranslation();

  if (save.isPending || paused.isPending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.lightOutput.saving')}</p>;
  const failed = save.error ?? paused.error;
  if (failed) {
    return (
      <p className={`${ui.problem} ${styles.socketWhy}`} role="alert">
        {refusalText(failed, t('devices.lightOutput.saveFailed'))}
      </p>
    );
  }

  return save.isSuccess ? (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {t('devices.lightOutput.saved')}
    </p>
  ) : null;
}

/**
 * The same receipt a socket's switch gets: it went out, and whether anybody was
 * listening - and, for a hold, how long it was asked to hold for.
 *
 * The device reports no override of its own output, so the row cannot count a
 * hold down the way a socket's line does. What it can say is what was sent, and
 * a hold whose length is never stated anywhere is a lamp forced on with no word
 * about when it hands itself back.
 */
function Asked({ ask, heldFor }: { ask: Mutation & { data?: { deviceOnline: boolean } }; heldFor: number | null }) {
  const { t } = useTranslation();

  if (ask.isPending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.socket.asking')}</p>;
  if (ask.error) {
    return (
      <p className={`${ui.problem} ${styles.socketWhy}`} role="alert">
        {refusalText(ask.error, t('devices.socket.askFailed'))}
      </p>
    );
  }
  if (!ask.data) return null;

  if (!ask.data.deviceOnline) {
    return (
      <p className={`${ui.note} ${styles.socketWhy}`} role="status">
        {t('devices.socket.notListening')}
      </p>
    );
  }

  return (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {heldFor === null ? t('devices.socket.asked') : t('devices.lightOutput.askedHold', { duration: durationLabel(heldFor) })}
    </p>
  );
}
