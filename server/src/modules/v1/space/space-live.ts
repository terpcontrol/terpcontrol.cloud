import type { CardSetpoint, CardValue, Metric, SpaceLiveDevice } from '@fg2/shared-types/v1';
import { metric } from '@fg2/shared-types/v1-schemas';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { LiveReading } from '@modules/data/data.service';
import { setpointsOf } from '../device/setpoints';

/**
 * What a space reads right now, put together from the devices standing in it.
 *
 * A card shows one figure per metric, while a tent may hold a controller and a
 * plug that both report a temperature: the newest reading wins, and the target
 * comes from the first device that holds one. The order is the one a card draws
 * them in, so no client sorts metrics by its own idea of what matters.
 */

/** The card's order: what a grower looks at first. `offline` is a device's state, not a reading. */
const CARD_ORDER: readonly Metric[] = [
  ...new Set<Metric>(['temperature', 'humidity', 'co2', 'vpd', ...metric.options.filter(name => name !== 'offline')]),
];

/** The metrics a controller holds a target for. */
const STEERED: readonly Metric[] = ['temperature', 'humidity', 'co2'];

export interface DeviceReading {
  device: StoredDevice;
  reading: LiveReading;
}

export const liveOfDevice = ({ device, reading }: DeviceReading): SpaceLiveDevice => {
  const targets = setpointsOf(device.configuration, reading.isDay);
  const active = targets ? targets[targets.active] : {};

  return {
    deviceId: device.id,
    values: orderValues(Object.entries(reading.metrics).map(([name, value]) => ({ metric: name as Metric, ...value }))),
    setpoints: STEERED.filter(name => active[name] !== undefined).map(name => ({ metric: name, value: active[name] as number })),
  };
};

export const mergeLive = (devices: SpaceLiveDevice[]): { values: CardValue[]; setpoints: CardSetpoint[] } => {
  const values = new Map<Metric, CardValue>();
  const setpoints = new Map<Metric, CardSetpoint>();

  for (const device of devices) {
    for (const value of device.values) {
      const known = values.get(value.metric);
      if (!known || (value.measuredAt ?? '') > (known.measuredAt ?? '')) values.set(value.metric, value);
    }
    for (const setpoint of device.setpoints) {
      if (!setpoints.has(setpoint.metric)) setpoints.set(setpoint.metric, setpoint);
    }
  }

  return { values: orderValues([...values.values()]), setpoints: STEERED.flatMap(name => setpoints.get(name) ?? []) };
};

const orderValues = <T extends { metric: Metric }>(values: T[]): T[] => CARD_ORDER.flatMap(name => values.filter(value => value.metric === name));
