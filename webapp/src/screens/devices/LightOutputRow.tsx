import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns, SocketOverrideState } from '@fg2/shared-types/v1';
import { useSaveConfiguration, useSetOverride } from '@/api/devices';
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
 */
export function LightOutputRow({ output, unheard, mayManage, runs, now }: LightOutputRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const override = useSetOverride();
  const save = useSaveConfiguration();

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
  const level = draft && draft.against === stored ? draft.percent : (stored ?? 100);

  const cannotSetLevel = output.configuration === null ? t('devices.lightOutput.noSettings') : null;
  const cannotForce = !output.takesOverride ? t('devices.lightOutput.needsFirmware') : unheard;
  // "Nothing is listening" is true of the buttons and not of the slider, so a
  // device nobody can reach says the whole of it in one line rather than a
  // refusal beside a control that works.
  const why = cannotForce && unheard && !cannotSetLevel ? t('devices.lightOutput.keptForLater') : cannotForce;

  const commit = () => {
    if (level === stored || !output.configuration) return;
    save.mutate({ deviceId: output.deviceId, configuration: withLightLimit(output.configuration, level) });
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
            aria-valuetext={percentLabel(level)}
            onChange={event => setDraft({ percent: Number(event.target.value), against: stored })}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span className={`mono ${styles.level}`}>{percentLabel(level)}</span>
          <span className={styles.forces} role="group" aria-label={t('devices.lightOutput.force')}>
            {(['auto', 'on', 'off'] as const).map(state => (
              <button key={state} type="button" className={styles.forceOption} disabled={cannotForce !== null} onClick={() => force(state)}>
                {t(`devices.socket.${state}`)}
              </button>
            ))}
          </span>
        </div>
      ) : null}

      {mayManage && cannotSetLevel ? <p className={ui.note}>{cannotSetLevel}</p> : null}
      {mayManage && why ? <p className={ui.note}>{why}</p> : null}
      <Saved save={save} />
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
 */
function Saved({ save }: { save: Mutation & { isSuccess: boolean } }) {
  const { t } = useTranslation();

  if (save.isPending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.lightOutput.saving')}</p>;
  if (save.error) {
    return (
      <p className={`${ui.problem} ${styles.socketWhy}`} role="alert">
        {save.error instanceof ApiError ? save.error.problem.detail || save.error.problem.title : t('devices.lightOutput.saveFailed')}
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
