import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { ActuatorRuns, ClimateVerdict, Device } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useLiveReads, useSocketTables } from '@/api/devices';
import { useSpaceOverview } from '@/api/spaces';
import { controlPath, leadingBackTo, socketPath } from '@/app/places';
import { lightOutputOf, useLightHolds } from '@/screens/devices/lights';
import { LightOutputRow } from '@/screens/devices/LightOutputRow';
import { socketName, socketState } from '@/screens/devices/socket-words';
import { Facts } from '@/ui/Facts';
import { Waiting } from '@/ui/PageState';
import { Row, Rows } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { ByDevice, NothingHere } from './ByDevice';
import { OwnOutputs } from './devices/OwnOutputs';
import { hasOutputs, outputsLine, outputsOf, standOf } from './rows';

/**
 * Ausgänge: what the place's devices drive beside holding the climate - the
 * controller's own lamp with its hold, a fridge's fans, an AIR fan's speed -
 * and the smart sockets, each a row that says its state, as of when once the
 * device has gone quiet, and leads to the socket's own page, where it is held
 * by hand.
 */
export function OutputsPage({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const now = useNow();
  const zone = useZone();
  const ids = devices.map(device => device.id);
  const tables = useSocketTables(ids);
  const reads = useLiveReads(ids);
  const verdict = useSpaceOverview(spaceId).data?.verdict;
  const held = useLightHolds(ids, now);
  const all = devices.map(device => outputsOf(device, tables.tables.get(device.id), reads.levels.get(device.id) ?? null)).filter(hasOutputs);
  const stood = (device: Device) => standOf(t, heardAt(device.state.lastSeenAt, reads.measuredAt.get(device.id) ?? null), now, zone);

  if (tables.isPending && all.length === 0) return <Waiting lines={3} />;
  if (all.length === 0) {
    return (
      <NothingHere to={controlPath(spaceId)} where={t('control.back')}>
        {t('control.outputs.none')}
      </NothingHere>
    );
  }

  return (
    <ByDevice
      devices={all.map(one => one.device)}
      line={device =>
        outputsLine(
          t,
          all.filter(one => one.device.id === device.id),
          now,
          zone,
          stood(device),
          held,
        )
      }
    >
      {device => {
        const sockets = all.find(one => one.device.id === device.id)?.sockets ?? [];
        const table = tables.tables.get(device.id);
        const light = table ? lightOutputOf(device, table.capabilities, reads.levels.get(device.id) ?? null) : null;
        const stand = stood(device);

        return (
          <>
            {light ? (
              <ul className={ui.group}>
                <LightOutputRow output={light} offline={stand !== null} mayManage={mayManage} runs={runsOf(verdict, 'light')} now={now} />
              </ul>
            ) : null}
            <OwnOutputs device={device} mayManage={mayManage} />
            {sockets.length > 0 ? (
              <Rows>
                {sockets.map(row => (
                  <Row
                    key={row.key}
                    to={socketPath(device.id, row.key)}
                    state={leadingBackTo(pathname + search)}
                    title={socketName(t, row)}
                    line={<Facts facts={[stand, socketState(t, row, now)]} />}
                  />
                ))}
              </Rows>
            ) : null}
          </>
        );
      }}
    </ByDevice>
  );
}

const runsOf = (verdict: ClimateVerdict | undefined, output: 'light'): ActuatorRuns | null =>
  verdict?.actuators.find(one => one.output === output) ?? null;
