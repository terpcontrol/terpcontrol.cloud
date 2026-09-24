import { ChevronDown, ChevronRight, Plug } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns, SocketOverrideState } from '@fg2/shared-types/v1';
import { useSetOverride, useTestSocket } from '@/api/devices';
import { ApiError } from '@/api/problem';
import ui from '@/ui/ui.module.css';
import { ageLabel, leftLabel } from '@/ui/age';
import { Fact, Facts } from './Facts';
import { defaultHold, durationLabel, holdsFor, TEST_SECONDS, type SocketRowModel } from './sockets';
import styles from './Devices.module.css';

/** How long a press has to be held before it counts as asking for a time rather than for a switch. */
const HOLD_MS = 450;

interface SocketRowProps {
  row: SocketRowModel;
  deviceId: string;
  /**
   * Why nothing on this row can be switched, or null when it can. It is the
   * device's answer rather than the row's - an old build and a device nobody is
   * listening on are both true of every row it has - so it is said once above
   * the list, and again under the times behind the chevron, where it is the
   * reason those chips and "Find it" are grey.
   */
  refusal: string | null;
  /**
   * Why the device would not hear anything at all, or null. Finding a socket is
   * a command every build in the field takes, so it is refused only for this
   * and never for the build being too old to hold one on.
   */
  unheard: string | null;
  mayManage: boolean;
  /** What this row's output did in the last day, where the tent's verdict is already in hand. */
  runs: ActuatorRuns | null;
  now: DateTime;
}

/**
 * One smart socket, with the override on its switch.
 *
 * A socket is a plug: it is on or it is off, and a lamp on one is at whatever
 * brightness its own driver gives it. That is the whole difference between this
 * row and the light output above it, and it is why this row carries a switch and
 * that one carries a dimmer.
 *
 * A tap forces the row the other way for a while; a tap while something is
 * forcing it hands it back to its role. Holding the switch opens the row, where
 * the times are - and so does the chevron, so the same thing is reachable
 * without a long press.
 *
 * Nothing here pretends a command arrived: the row goes on showing what the
 * device last reported, and what the command answered is said underneath.
 */
export function SocketRow({ row, deviceId, refusal, unheard, mayManage, runs, now }: SocketRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const override = useSetOverride();
  const test = useTestSocket();
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forced = row.override && row.override.state !== 'auto' ? row.override : null;
  const name = nameOf(t, row);

  const send = (state: SocketOverrideState, forSeconds: number) => override.mutate({ deviceId, target: row.target, state, forSeconds });

  /** A tap means "the other way" - and, while something is forcing the row, "let go". */
  const flip = () => {
    if (forced) return send('auto', 0);
    send(row.state === 'on' ? 'off' : 'on', defaultHold());
  };

  const startHold = () => {
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      setOpen(true);
    }, HOLD_MS);
  };

  const endHold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <li className={`${ui.card} ${styles.socket}`}>
      <div className={styles.socketHead}>
        <Plug className={styles.socketIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{name}</span>
          <span className={styles.rowNote}>{subtitle(t, row, now)}</span>
        </div>
        <span className={`mono ${styles.socketState}`}>{stateLine(t, row, runs, now, mayManage)}</span>
        {mayManage ? (
          <Control
            row={row}
            name={name}
            forced={forced !== null}
            refusal={refusal}
            onFlip={() => {
              if (held.current) return;
              flip();
            }}
            onSet={send}
            onHoldStart={startHold}
            onHoldEnd={endHold}
          />
        ) : null}
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          aria-label={t('devices.socket.details', { name })}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={16} strokeWidth={2} aria-hidden /> : <ChevronRight size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>

      <Receipt result={override.data} error={override.error} pending={override.isPending} />

      {open ? (
        <div className={styles.socketPanel}>
          <Facts>
            <Fact label={t('devices.socket.slot')} value={row.slot < 0 ? t('devices.socket.byRole') : String(row.slot)} />
            {row.address ? <Fact label={t('devices.socket.address')} value={row.address} /> : null}
            {row.hardwareId ? <Fact label={t('devices.socket.hardwareId')} value={row.hardwareId} /> : null}
            {row.stateChangedAt ? (
              <Fact label={t('devices.socket.changed')} value={t('devices.ago', { age: ageLabel(row.stateChangedAt, now) })} />
            ) : null}
            {runs ? <Fact label={t('devices.socket.runs')} value={t('devices.socket.runsValue', { count: runs.runCount })} /> : null}
          </Facts>

          {mayManage ? (
            <div className={styles.holds}>
              <span className="label">{t('devices.socket.holdFor')}</span>
              {holdsFor().map(seconds => (
                <button
                  key={seconds}
                  type="button"
                  className={ui.chip}
                  disabled={refusal !== null}
                  onClick={() => send(row.state === 'on' ? 'off' : 'on', seconds)}
                >
                  {durationLabel(seconds)}
                </button>
              ))}
              {forced ? (
                <button type="button" className={ui.chip} disabled={refusal !== null} onClick={() => send('auto', 0)}>
                  {t('devices.socket.backToAuto')}
                </button>
              ) : null}
              {row.slot >= 0 ? (
                <button
                  type="button"
                  className={ui.chip}
                  disabled={unheard !== null}
                  onClick={() => test.mutate({ deviceId, slot: row.slot, forSeconds: TEST_SECONDS })}
                >
                  {t('devices.socket.findIt')}
                </button>
              ) : null}
              {/* A control that stops working with its reason a scroll away is
                  a control with no reason at all, and these are the ones a
                  person opens the row to reach. The list above says it for the
                  switches on the rows that are shut; this says it here, where
                  the grey chips are. */}
              {refusal ? <p className={`${ui.note} ${styles.whyGrey}`}>{refusal}</p> : null}
            </div>
          ) : null}
          <Receipt result={test.data} error={test.error} pending={test.isPending} />
        </div>
      ) : null}
    </li>
  );
}

interface ControlProps {
  row: SocketRowModel;
  name: string;
  forced: boolean;
  refusal: string | null;
  onFlip: () => void;
  onSet: (state: SocketOverrideState, forSeconds: number) => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

/**
 * The switch, where the device says what the row is doing - and the three-way
 * where it does not. A row whose state is unknown is a socket the module has
 * never commanded or one that stopped answering: a switch would have to be drawn
 * in a position nobody checked, and that is the one thing it must not do.
 */
function Control({ row, name, forced, refusal, onFlip, onSet, onHoldStart, onHoldEnd }: ControlProps) {
  const { t } = useTranslation();

  if (row.state === 'unknown') {
    const current: SocketOverrideState = forced ? (row.override!.state as SocketOverrideState) : 'auto';

    return (
      <span className={ui.segments} role="group" aria-label={t('devices.socket.force', { name })}>
        {(['auto', 'on', 'off'] as const).map(state => (
          <button
            key={state}
            type="button"
            className={`${ui.segment} ${styles.threeWayOption}`}
            aria-pressed={state === current}
            disabled={refusal !== null}
            onClick={() => onSet(state, state === 'auto' ? 0 : defaultHold())}
          >
            {t(`devices.socket.${state}`)}
          </button>
        ))}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={ui.switch}
      role="switch"
      aria-checked={row.state === 'on'}
      aria-label={t('devices.socket.force', { name })}
      disabled={refusal !== null}
      onClick={onFlip}
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerLeave={onHoldEnd}
      onPointerCancel={onHoldEnd}
    >
      <span className={ui.knob} aria-hidden />
    </button>
  );
}

/**
 * What the command answered. MQTT hands back no receipt, so the honest line is
 * that it went out and whether anybody was listening - never that the socket
 * switched.
 */
function Receipt({ result, error, pending }: { result?: { deviceOnline: boolean }; error: Error | null; pending: boolean }) {
  const { t } = useTranslation();

  if (pending) return <p className={`${ui.note} ${styles.socketWhy}`}>{t('devices.socket.asking')}</p>;
  if (error) {
    return (
      <p className={`${ui.problem} ${styles.socketWhy}`} role="alert">
        {error instanceof ApiError ? error.problem.detail || error.problem.title : t('devices.socket.askFailed')}
      </p>
    );
  }
  if (!result) return null;

  return (
    <p className={`${ui.note} ${styles.socketWhy}`} role="status">
      {t(result.deviceOnline ? 'devices.socket.asked' : 'devices.socket.notListening')}
    </p>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The row's name: the role, numbered where the role holds more than one socket.
 * Two lamps in one tent are two rows called "Light", and a person switching one
 * of them off has to know which one they have got.
 */
const nameOf = (t: Translate, row: SocketRowModel): string =>
  row.ordinal === null ? t(row.titleKey) : t('devices.socket.numbered', { name: t(row.titleKey), number: row.ordinal });

/**
 * What the row is: a plug, and where the device finds it - or the cycle a timed
 * socket repeats.
 *
 * It says "plug" first because the row above it may be the controller's own
 * output, and the difference between the two is the whole point: this one is a
 * socket on the network that is on or off, that one is a channel of the module
 * that dims.
 *
 * A socket that was answering and stopped says that here instead, and says
 * since when.
 */
const subtitle = (t: Translate, row: SocketRowModel, now: DateTime): string => {
  if (row.state === 'unknown' && row.stateChangedAt) return t('devices.socket.quiet', { age: ageLabel(row.stateChangedAt, now) });

  const rest = row.timer
    ? t('devices.socket.timer', { on: durationLabel(row.timer.onSeconds), every: durationLabel(row.timer.everySeconds) })
    : row.address;

  return [t('devices.socket.isPlug'), rest].filter(Boolean).join(' · ');
};

/**
 * On or off, what is forcing it and for how much longer, and how often it came
 * on today where the tent's day has already been read.
 *
 * A row the device says nothing about is left blank where the three-way is
 * drawn beside it - that control already says nothing is forcing it, and two
 * ways of saying the same thing is what squeezes the name out of the row. With
 * no control, the row says it in words instead.
 */
const stateLine = (t: Translate, row: SocketRowModel, runs: ActuatorRuns | null, now: DateTime, mayManage: boolean): string => {
  const forced = row.override && row.override.state !== 'auto' ? row.override : null;
  if (forced) {
    return t('devices.socket.forced', { state: t(`devices.socket.${forced.state}`), left: leftLabel(forced.validUntil, now) });
  }
  // A row nothing is known about carries no run count either: there is nothing
  // for it to sit beside, and the panel behind the row has the number anyway.
  // A socket that fell silent has said so on the line above.
  if (row.state === 'unknown') return mayManage || row.stateChangedAt ? '' : t('devices.socket.unknownState');

  return [t(`devices.socket.${row.state}`), runs ? t('devices.socket.ran', { count: runs.runCount }) : null].filter(Boolean).join(' · ');
};
