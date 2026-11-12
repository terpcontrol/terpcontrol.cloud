import { Lightbulb } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns, SocketOverrideState } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSetOverride } from '@/api/devices';
import { ageLabel, durationLabel } from '@/ui/age';
import { readStoredJson, writeStored } from '@/ui/stored';
import { clock, useZone } from '@/ui/zone';
import { Help } from '@/ui/Help';
import ui from '@/ui/ui.module.css';
import { Expand, Fact, Facts, Receipt } from './RowParts';
import { percentLabel, type LightOutput } from './lights';
import { DEFAULT_HOLD_SECONDS, HOLD_SECONDS } from './sockets';
import styles from './Devices.module.css';

interface LightOutputRowProps {
  output: LightOutput;
  /** Why the device would hear no command, or null. */
  unheard: string | null;
  mayManage: boolean;
  /** What the light output did in the last day, where the tent's verdict is already in hand. */
  runs: ActuatorRuns | null;
  now: DateTime;
}

/**
 * The controller's own light output, under Ausgänge: what the lamp is running
 * at, and holding it on or off for a while.
 *
 * The level is a reading, and the only fact here the device vouches for: an
 * override is never reported back, so the row dates the level and remembers
 * the hold it sent itself. Holding is a command: it is heard or it is not, it
 * dies with a reboot, and a build that has not announced it is never sent one.
 * How bright the lamp may get is a setting and stands with the light's hours
 * on Steuerung; here it is a fact behind the chevron.
 */
export function LightOutputRow({ output, unheard, mayManage, runs, now }: LightOutputRowProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const [open, setOpen] = useState(false);
  const override = useSetOverride();

  // A level is a reading and carries the verdict the server passed on it, so a
  // lamp nobody has heard from in ten minutes is dimmed and dated rather than
  // drawn as though it were still at that brightness.
  const measured = output.level;
  const freshness = measured?.state ?? 'offline';

  // Why a hold is out of reach: a type whose firmware holds no output on
  // command in any build, a build that has not announced it, or a device
  // nobody is listening on. The buttons are drawn only where one could be
  // asked for; beside a device that can take none they looked as pressable as
  // any other choice, and the note says why.
  const neverHolds = !SOCKET_HOST_TYPES.includes(output.type);
  const offersHold = !neverHolds && output.takesOverride && unheard === null;
  const why = neverHolds
    ? t('devices.lightOutput.neverHolds')
    : !output.takesOverride
      ? t('devices.lightOutput.needsFirmware')
      : unheard
        ? t('devices.lightOutput.holdWaits')
        : null;

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
  const [hold, setHold] = useState(DEFAULT_HOLD_SECONDS);
  const [asked, setAsked] = useState<number | null>(null);
  // The device reports no hold of its own light, so the last one sent from
  // here is remembered until it runs out: the button pressed stays marked and
  // says until when, instead of three buttons none of which is in force.
  const [sentHold, setSentHold] = useState<SentHold | null>(() => readHold(output.deviceId));
  const holding = sentHold !== null && sentHold.until > now.toMillis() ? sentHold : null;

  const force = (state: SocketOverrideState) => {
    const forSeconds = state === 'auto' ? 0 : hold;
    setAsked(state === 'auto' ? null : forSeconds);
    override.mutate(
      { deviceId: output.deviceId, target: { kind: 'output', output: 'light' }, state, forSeconds },
      {
        onSuccess: result => {
          const next = state === 'auto' || !result.deviceOnline ? null : { state, until: now.toMillis() + forSeconds * 1000 };
          setSentHold(next);
          writeHold(output.deviceId, next);
        },
      },
    );
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
            ? t('devices.lightOutput.now', { percent: percentLabel(measured.percent), age: ageLabel(measured.measuredAt, now) })
            : t('devices.lightOutput.noLevel')}
        </span>
        <Expand open={open} label={t('devices.socket.details', { name: t('devices.lightOutput.title') })} onToggle={() => setOpen(!open)} />
      </div>

      {/* The group carries the duration rather than each button, so the three
          keep the one-word names they are drawn with and a reader hears how
          long a hold lasts once, where the choice belongs. */}
      {mayManage && offersHold ? (
        <div className={styles.dimmer}>
          <span className={ui.segments} role="group" aria-label={t('devices.lightOutput.forceFor', { duration: durationLabel(hold) })}>
            {(['auto', 'on', 'off'] as const).map(state => (
              <button
                key={state}
                type="button"
                className={`${ui.segment} ${styles.forceOption}`}
                aria-pressed={holding ? holding.state === state : state === 'auto'}
                onClick={() => force(state)}
              >
                {t(`devices.socket.${state}`)}
              </button>
            ))}
          </span>
          <span className={`mono ${styles.holdLength}`}>
            {holding
              ? t(`devices.lightOutput.holding.${holding.state}`, { until: clock(DateTime.fromMillis(holding.until).toISO() ?? '', zone) })
              : t('devices.lightOutput.holds', { duration: durationLabel(hold) })}
          </span>
          <Help topic="lightHold" />
        </div>
      ) : null}

      {mayManage && why ? <p className={ui.note}>{why}</p> : null}
      <Receipt result={override.data} error={override.error} pending={override.isPending} heldFor={asked} />

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

          {/* The same times a smart socket is held for: the firmware holds anything for any of them. */}
          {mayManage && offersHold ? (
            <div className={styles.holds}>
              <span className="label">{t('devices.socket.holdFor')}</span>
              {HOLD_SECONDS.map(seconds => (
                <button key={seconds} type="button" className={ui.chip} aria-pressed={seconds === hold} onClick={() => setHold(seconds)}>
                  {durationLabel(seconds)}
                </button>
              ))}
            </div>
          ) : null}

          <p className={ui.note}>{t('devices.lightOutput.explained')}</p>
        </div>
      ) : null}
    </li>
  );
}

/** A hold of the light output sent from this browser, and when it runs out. */
interface SentHold {
  state: 'on' | 'off';
  until: number;
}

const HOLD_KEY = (deviceId: string) => `terp.lightHold.${deviceId}`;

/** What this browser last sent, if anything: a preference of this screen and never a fact the device confirmed. */
const readHold = (deviceId: string): SentHold | null => {
  const stored = readStoredJson<SentHold>(HOLD_KEY(deviceId));
  return stored && (stored.state === 'on' || stored.state === 'off') && typeof stored.until === 'number' ? stored : null;
};

const writeHold = (deviceId: string, hold: SentHold | null) => writeStored(HOLD_KEY(deviceId), hold ? JSON.stringify(hold) : null);
