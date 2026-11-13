import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { heardAt } from '@fg2/shared-types/v1-schemas/value-age.js';
import { useAlarmRulesOf } from '@/api/alarm-rules';
import { useDeviceLive, useLiveReads, useSocketTables } from '@/api/devices';
import { useDevicePlans } from '@/api/plans';
import { controlPath, type ControlPage } from '@/app/places';
import { useLightHolds } from '@/screens/devices/lights';
import { Facts } from '@/ui/Facts';
import { Row, Rows } from '@/ui/Rows';
import { useZone } from '@/ui/zone';
import { watchable } from './alarms/rules';
import { pendingByPath } from './climate/figures';
import { usePauseReasons } from './plan-labels';
import { alarmsLine, followsPlan, hasMode, hasOutputs, modeLine, outputsLine, outputsOf, planLine, standOf, type RowLine } from './rows';

/**
 * The rows that open the pages behind Steuerung - alarm rules, grow plan,
 * outputs, work mode - each saying its page's state, and none drawn whose page
 * would hold nothing or only repeat the card over the rows. Steuerung draws
 * them for a place, whose climate comes first in `devices`; a device's own
 * page for that device `alone`, its rows opening the pages with it unfolded.
 */
export function PageRows({
  spaceId,
  devices,
  now,
  alone = false,
  children = null,
}: {
  spaceId: string;
  devices: Device[];
  now: DateTime;
  alone?: boolean;
  /** Rows that stand before these. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const ids = devices.map(device => device.id);
  const first = devices[0] ?? null;
  const rules = useAlarmRulesOf(ids);
  const plans = useDevicePlans(ids);
  const tables = useSocketTables(ids);
  const reads = useLiveReads(ids);
  const held = useLightHolds(ids, now);
  const pending = pendingByPath(useDeviceLive(first?.id ?? null).data?.pending);
  usePauseReasons(plans.plans);
  const outputs = devices
    .map(device => outputsOf(device, tables.tables.get(device.id), reads.levels.get(device.id) ?? null, device.id === first?.id))
    .filter(hasOutputs);
  const moded = devices.find(hasMode) ?? null;
  const stand = first ? standOf(t, heardAt(first.state.lastSeenAt, reads.measuredAt.get(first.id) ?? null), now, zone) : null;
  const planned = devices.filter(followsPlan);
  const row = (page: ControlPage, has: boolean, line: RowLine | null) =>
    has ? (
      <Row
        key={page}
        to={controlPath(spaceId, page, alone && first ? { device: first.id } : {})}
        title={t(`control.page.${page}`)}
        line={line ? <Facts facts={line.text.split(' · ')} /> : null}
        warn={line?.warn}
      />
    ) : null;

  return (
    <nav aria-label={t(alone ? 'device.steering' : 'control.rows.label')}>
      <Rows grid={!alone}>
        {children}
        {row(
          'alarms',
          devices.some(watchable) || rules.rules.size > 0,
          rules.isPending ? null : alarmsLine(t, [...rules.rules.values()], [...rules.counts.values()]),
        )}
        {row(
          'plan',
          plans.plans.length > 0 || planned.length > 0,
          plans.isPending
            ? null
            : planLine(
                t,
                plans.plans,
                now,
                planned.some(device => device.control?.running !== false),
              ),
        )}
        {row('outputs', outputs.length > 0, outputsLine(t, outputs, now, zone, stand, held, pending))}
        {row('mode', moded !== null, moded ? modeLine(t, moded, now, zone, moded.id === first?.id ? pending : undefined) : null)}
      </Rows>
    </nav>
  );
}
