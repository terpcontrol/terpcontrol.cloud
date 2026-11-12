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
import { climateLanding } from '@/ui/climate-hardware';
import { Facts } from '@/ui/Facts';
import { Row, Rows } from '@/ui/Rows';
import { useZone } from '@/ui/zone';
import { watchable } from './alarms/rules';
import { savedWords } from './climate/figures';
import { alarmsLine, hasMode, hasOutputs, modeLine, outputsLine, outputsOf, pendingBehind, planLine, standOf, type RowLine } from './rows';

/**
 * The rows that open the pages behind Steuerung - alarm rules, grow plan,
 * outputs, work mode - each saying its page's state, and none drawn whose page
 * would hold nothing: a socket has no plan a step could write into and no
 * mode. Steuerung draws them for a place, whose climate comes first in
 * `devices`; a device's own page for that device `alone`, and its rows open
 * the pages with it unfolded (`?device=`).
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
  const pending = useDeviceLive(first?.id ?? null).data?.pending?.settings ?? [];
  // An AIR fan's speed is its own control on its own page: Ausgänge would only say it again and lead back.
  const outputs = devices
    .map(device => outputsOf(device, tables.tables.get(device.id), reads.levels.get(device.id) ?? null))
    .map(one => (alone ? { ...one, speed: false } : one))
    .filter(hasOutputs);
  const moded = devices.find(hasMode) ?? null;
  const stand = first ? standOf(t, heardAt(first.state.lastSeenAt, reads.measuredAt.get(first.id) ?? null), now, zone) : null;
  const waits = (row: 'mode' | 'outputs', line: RowLine): RowLine => {
    const behind = pendingBehind(pending, row);
    return behind ? { text: `${line.text} · ${t('control.pending.behind', { saved: savedWords(t, behind.savedAt, now, zone) })}`, warn: true } : line;
  };
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
        {row('alarms', devices.some(watchable) || rules.rules.size > 0, rules.isPending ? null : alarmsLine(t, [...rules.rules.values()]))}
        {row(
          'plan',
          plans.plans.length > 0 || devices.some(device => climateLanding(device) !== 'nowhere'),
          plans.isPending ? null : planLine(t, plans.plans, now),
        )}
        {row('outputs', outputs.length > 0, waits('outputs', outputsLine(t, outputs, now, zone, stand, held)))}
        {row('mode', moded !== null, moded ? waits('mode', modeLine(t, moded)) : null)}
      </Rows>
    </nav>
  );
}
