import { Lightbulb } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { ActuatorRuns } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { ageLabel, sinceLabel } from '@/ui/age';
import { Facts } from '@/ui/Facts';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { HandHold } from './HandHold';
import { percentLabel, rememberLightHold, useLightHold, type LightOutput } from './lights';
import styles from './Devices.module.css';

interface LightOutputRowProps {
  output: LightOutput;
  /** Nobody is listening on the device, so no command would be heard. */
  offline: boolean;
  mayManage: boolean;
  /** What the light output did in the last day, where the tent's verdict is already in hand. */
  runs: ActuatorRuns | null;
  now: DateTime;
}

const LIGHT = { kind: 'output', output: 'light' } as const;

/**
 * The controller's own light output, under Ausgänge: what the lamp is running
 * at, and holding it on or off for a while.
 *
 * The level is a reading, and the only fact here the device vouches for, so
 * it is dated. A hold is a command the device never
 * reports back, so the row says the one this browser sent until its time is
 * up (`useLightHold`). It dies with a reboot, and it is offered only where
 * one could be asked for - a type that holds, a build that announced it, a
 * device that is listening; anywhere else one sentence says why.
 */
export function LightOutputRow({ output, offline, mayManage, runs, now }: LightOutputRowProps) {
  const { t } = useTranslation();
  const zone = useZone();
  const held = useLightHold(output.deviceId, now);
  const title = t('devices.lightOutput.title');
  const measured = output.level;
  const quiet = measured?.state === 'offline';
  const why = !SOCKET_HOST_TYPES.includes(output.type)
    ? t('devices.lightOutput.neverHolds')
    : !output.takesOverride
      ? t('devices.lightOutput.needsFirmware')
      : offline
        ? t('devices.lightOutput.holdWaits')
        : null;

  return (
    <li className={`${ui.card} ${styles.output}`}>
      <div className={styles.outputHead}>
        <Lightbulb className={styles.outputIcon} size={18} strokeWidth={1.75} aria-hidden />
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          {/* What the lamp runs at, dated like any reading; gone quiet, it is the level as of then. */}
          <span className={`mono ${styles.rowNote}`}>
            <Facts
              facts={
                measured
                  ? [
                      quiet ? percentLabel(measured.percent) : t('devices.lightOutput.now', { percent: percentLabel(measured.percent) }),
                      quiet
                        ? t('device.asOf', { time: sinceLabel(measured.measuredAt, now, zone) })
                        : t('devices.ago', { age: ageLabel(measured.measuredAt, now) }),
                      runs ? t('devices.socket.runsValue', { count: runs.runCount }) : null,
                    ]
                  : [t('devices.lightOutput.noLevel')]
              }
            />
          </span>
        </div>
      </div>

      {!mayManage ? null : why ? (
        <p className={ui.note}>{why}</p>
      ) : (
        <HandHold
          name={title}
          deviceId={output.deviceId}
          target={LIGHT}
          held={held}
          standing={held ? t(`devices.lightOutput.holding.${held.state}`, { until: sinceLabel(held.until, now, zone) }) : null}
          help="lightHold"
          now={now}
          onHeard={hold => rememberLightHold(output.deviceId, hold)}
        />
      )}
    </li>
  );
}
