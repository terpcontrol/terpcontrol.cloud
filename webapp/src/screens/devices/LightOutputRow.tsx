import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns, SocketOverrideState } from '@fg2/shared-types/v1';
import { useSaveConfiguration, useSetOverride } from '@/api/devices';
import { isMissing, useDevicePlan, usePlanTransition } from '@/api/plans';
import { ApiError } from '@/api/problem';
import { ageLabel } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { Fact, Facts } from './Facts';
import { LEVEL_STEP, percentLabel, withLightLimit, type LightOutput } from './lights';
import { defaultHold } from './sockets';
import styles from './Devices.module.css';

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
  const cannotForce = !output.takesOverride ? t('devices.lightOutput.needsFirmware') : unheard;
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
      await save.mutateAsync({ deviceId: output.deviceId, configuration: withLightLimit(output.configuration, level) });
    } catch {
      // Said under the row, by whichever of the two refused.
    }
  };

  const force = (state: SocketOverrideState) =>
    override.mutate({
      deviceId: output.deviceId,
      target: { kind: 'output', output: 'light' },
      state,
      forSeconds: state === 'auto' ? 0 : defaultHold(),
    });

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
          <input
            id={`level-${output.deviceId}`}
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            step={LEVEL_STEP}
            value={level}
            disabled={cannotSetLevel !== null}
            aria-valuetext={stated}
            onChange={event => setDraft({ percent: Number(event.target.value), against: stored })}
            onPointerUp={() => void commit()}
            onKeyUp={() => void commit()}
            onBlur={() => void commit()}
          />
          <span className={`mono ${styles.level}`}>{stated}</span>
          <span className={styles.forces} role="group" aria-label={t('devices.lightOutput.force')}>
            {(['auto', 'on', 'off'] as const).map(state => (
              <button key={state} type="button" className={styles.forceOption} disabled={cannotForce !== null} onClick={() => force(state)}>
                {t(`devices.socket.${state}`)}
              </button>
            ))}
          </span>
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
      <Asked ask={override} />

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
        {failed instanceof ApiError ? failed.problem.detail || failed.problem.title : t('devices.lightOutput.saveFailed')}
      </p>
    );
  }

  return save.isSuccess ? (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {t('devices.lightOutput.saved')}
    </p>
  ) : null;
}

/** The same receipt a socket's switch gets: it went out, and whether anybody was listening. */
function Asked({ ask }: { ask: Mutation & { data?: { deviceOnline: boolean } } }) {
  const { t } = useTranslation();

  if (ask.isPending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.socket.asking')}</p>;
  if (ask.error) {
    return (
      <p className={`${ui.problem} ${styles.socketWhy}`} role="alert">
        {ask.error instanceof ApiError ? ask.error.problem.detail || ask.error.problem.title : t('devices.socket.askFailed')}
      </p>
    );
  }
  if (!ask.data) return null;

  return (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {t(ask.data.deviceOnline ? 'devices.socket.asked' : 'devices.socket.notListening')}
    </p>
  );
}
