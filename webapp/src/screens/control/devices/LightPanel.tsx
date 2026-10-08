import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { FIRMWARE_LIGHTS_OFF, FIRMWARE_LIGHTS_ON, roundTheClock } from '@fg2/shared-types/v1-schemas/day-night.js';
import { Block } from '@/ui/SheetParts';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import type { Unsaved } from '../targets/LeaveGuard';
import { TargetRow } from '../targets/TargetRow';
import { offsetOf } from '../targets/targets-draft';
import { useFieldsDraft } from './fields-draft';
import { OwnPanel, TimeRow } from './OwnPanel';

/**
 * A LIGHT: when it comes on and goes off, on the account's wall clock, and how
 * bright it gets in between. That is the whole of a lamp module's job, and
 * until now its schedule could only be set on the device's own menu, in UTC.
 * How long it fades in and out and the temperature it protects itself from
 * stand under Erweitert in the device's panel.
 */

const FIELDS = ['lightsOn', 'lightsOff', 'brightness'];

export function LightPanel(props: {
  device: Device;
  name: string;
  titled: boolean;
  mayManage: boolean;
  report: (deviceId: string, entry: Unsaved | null) => void;
  asking: boolean;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const draft = useFieldsDraft(props.device, FIELDS);
  const readOnly = !props.mayManage;
  const offset = offsetOf(now, zone);
  const on = draft.value<number>('lightsOn', FIRMWARE_LIGHTS_ON);
  const off = draft.value<number>('lightsOff', FIRMWARE_LIGHTS_OFF);
  // The lamp is dark all day where both times are the same: the firmware reads that as no day at all.
  const hours = roundTheClock(off - on) / 3600;

  return (
    <OwnPanel {...props} draft={draft}>
      <Block grouped label={t('lightSettings.title')} help="lightSchedule">
        <TimeRow
          id={`light-${props.device.id}-on`}
          label={t('lightSettings.on')}
          seconds={on}
          offset={offset}
          disabled={readOnly}
          onChange={seconds => draft.set('lightsOn', seconds)}
        />
        <TimeRow
          id={`light-${props.device.id}-off`}
          label={t('lightSettings.off')}
          seconds={off}
          offset={offset}
          disabled={readOnly}
          aside={t('lightSettings.hours', { hours: hoursLabel(hours, i18n.language) })}
          onChange={seconds => draft.set('lightsOff', seconds)}
        />
        <TargetRow
          id={`light-${props.device.id}-brightness`}
          label={t('targets.light')}
          name={t('targets.aria.lightLimit')}
          value={draft.value<number>('brightness', 100)}
          min={0}
          max={100}
          step={5}
          unit={t('targets.unit.percent')}
          help="lightLimit"
          disabled={readOnly}
          onChange={value => draft.set('brightness', value)}
        />
      </Block>
    </OwnPanel>
  );
}

/** "16", "12,5": whole hours as they are, a quarter or a half with its decimals in the reader's language. */
const hoursLabel = (hours: number, language: string): string => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(hours);
