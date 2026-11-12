import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { ActuatorRuns, ClimateVerdict, Device } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useLiveReads, useSocketTables } from '@/api/devices';
import { useSpaceOverview } from '@/api/spaces';
import { leadingBackTo, socketPath } from '@/app/places';
import { lightOutputOf } from '@/screens/devices/lights';
import { LightOutputRow } from '@/screens/devices/LightOutputRow';
import { deviceLiveness } from '@/ui/age';
import { deviceName } from '@/ui/naming';
import { Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { FanPanel } from './devices/FanPanel';
import { FridgeFansPanel } from './devices/FridgeFansPanel';
import { Guarded } from './OwnSettings';
import { socketName, socketState } from '@/screens/devices/socket-words';
import { hasOutputs, outputsOf } from './rows';
import styles from './Control.module.css';

/**
 * Ausgänge: what the place's devices drive beside holding the climate - the
 * controller's own lamp with its hold, a fridge's fans, an AIR fan's speed -
 * and the smart sockets, each a row that says its state and leads to the
 * socket's own page, where it is switched by hand.
 */
export function OutputsPage({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const now = useNow();
  const ids = devices.map(device => device.id);
  const tables = useSocketTables(ids);
  const reads = useLiveReads(ids);
  const verdict = useSpaceOverview(spaceId).data?.verdict;
  const all = devices.map(device => outputsOf(device, tables.tables.get(device.id), reads.levels.get(device.id) ?? null)).filter(hasOutputs);

  if (tables.isPending && all.length === 0) return <Waiting lines={3} />;
  if (all.length === 0) return <p className={`${ui.cardDashed} ${ui.note}`}>{t('control.outputs.none')}</p>;

  return (
    <div className={styles.page}>
      <Guarded>
        {own =>
          all.map(({ device, sockets }) => {
            const table = tables.tables.get(device.id);
            const light = table ? lightOutputOf(device, table.capabilities, reads.levels.get(device.id) ?? null) : null;
            const offline = deviceLiveness(heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null), now) === 'offline';
            const name = deviceName(device, t);

            return (
              <section key={device.id} className={styles.block} aria-label={name}>
                {all.length > 1 ? <h2 className={styles.blockTitle}>{name}</h2> : null}
                {light ? (
                  <ul className={ui.group}>
                    <LightOutputRow
                      output={light}
                      unheard={offline ? t('control.outputs.unheard') : null}
                      mayManage={mayManage}
                      runs={runsOf(verdict, 'light')}
                      now={now}
                    />
                  </ul>
                ) : null}
                {device.type === 'fridge' && device.configuration ? (
                  <FridgeFansPanel device={device} name={name} titled={false} mayManage={mayManage} {...own} />
                ) : null}
                {device.type === 'fan' && device.configuration ? (
                  <FanPanel device={device} name={name} titled={false} mayManage={mayManage} {...own} />
                ) : null}
                {sockets.length > 0 ? (
                  <Rows>
                    {sockets.map(row => (
                      <Row
                        key={row.key}
                        to={socketPath(device.id, row.key)}
                        state={leadingBackTo(pathname + search)}
                        title={socketName(t, row)}
                        line={socketState(t, row, now)}
                      />
                    ))}
                  </Rows>
                ) : null}
              </section>
            );
          })
        }
      </Guarded>
    </div>
  );
}

const runsOf = (verdict: ClimateVerdict | undefined, output: 'light'): ActuatorRuns | null =>
  verdict?.actuators.find(one => one.output === output) ?? null;
