import { useTranslation } from 'react-i18next';
import type { Device, DeviceConfiguration } from '@fg2/shared-types/v1';
import { FIRMWARE_LIGHTS_OFF, FIRMWARE_LIGHTS_ON, lightsOffOf } from '@fg2/shared-types/v1-schemas/day-night.js';
import { useHeardAt } from '@/api/devices';
import { fieldValue } from '@/ui/advanced/field-values';
import { offlineLabel } from '@/ui/age';
import { useNow } from '@/ui/useNow';
import { offsetOf, wallClock } from '@/ui/wall-clock';
import { useZone } from '@/ui/zone';
import { figureText } from '../climate/figures';
import { LightCard } from '../climate/LightCard';
import { useSettings } from '../climate/saved';
import { nowHoldingOf, shapeOf } from '../targets/day-night';
import { scheduleTitle } from '../targets/schedule-words';
import { draftOf } from '../targets/targets-draft';

/**
 * A LIGHT: when it comes on, for how long and how bright it gets, on the card
 * and the sheet a controller's lamp has. Its document keeps the two times and
 * the brightness at its top; its ramps and the temperature it protects itself
 * from stand under Erweitert on its page.
 */

/** Where a controller's document keeps what a LIGHT keeps at the top of its own. */
const AS_LAMP: Readonly<Record<string, string>> = { day: 'daynight.day', night: 'daynight.night', limit: 'lights.limit' };

/** The longest day a LIGHT can be told: it holds two times of day, and two equal ones are no day at all. */
const LONGEST_HOURS = 23.5;

export function LightPanel({ device, mayManage }: { device: Device; mayManage: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const settings = useSettings(device);
  const heard = useHeardAt(device);
  const offset = offsetOf(now, zone);
  const figure = (name: string, fallback: number): number => {
    const value = fieldValue(device, name);
    return typeof value === 'number' ? value : fallback;
  };
  const stored: DeviceConfiguration = {
    daynight: { day: figure('lightsOn', FIRMWARE_LIGHTS_ON), night: figure('lightsOff', FIRMWARE_LIGHTS_OFF) },
    lights: { limit: figure('brightness', 100), sunrise: figure('sunrise', 0), sunset: figure('sunset', 0) },
  };
  const lamp: Device = { ...device, configuration: stored };
  const baseline = draftOf(stored);
  const shape = shapeOf(lamp, baseline);
  // A lamp goes by its clock and says nothing of the half it is in: the schedule is its word.
  const holding = nowHoldingOf({
    device: lamp,
    shape,
    stored: baseline,
    live: null,
    offline: settings.offline,
    awaiting: true,
    now,
    clock: seconds => wallClock(seconds, offset),
  });

  return (
    <LightCard
      device={lamp}
      stored={stored}
      shape={shape}
      baseline={baseline}
      now={now}
      offset={offset}
      holding={holding}
      offline={settings.offline ? offlineLabel(heard, now, zone, true) : null}
      pending={new Map([...settings.pending].map(([path, held]) => [AS_LAMP[path] ?? path, held]))}
      longest={LONGEST_HOURS}
      mayManage={mayManage}
      busy={settings.busy}
      error={settings.error}
      onTimes={next => settings.write({ lightsOn: next.lightsOn, lightsOff: lightsOffOf(next) }, scheduleTitle(t, next, offset))}
      onLimit={value => settings.write({ brightness: value }, `${t('targets.aria.lightLimit')} ${figureText('lightLimit', value)}`)}
    />
  );
}
