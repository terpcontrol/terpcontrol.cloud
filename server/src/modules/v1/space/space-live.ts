import type { CardSetpoint, CardValue, Metric, SpaceLiveDevice } from '@fg2/shared-types/v1';
import { TARGET_BAND, metric } from '@fg2/shared-types/v1-schemas';
import { STEERED, steeredIn } from '@common/v1/steering';
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

export interface DeviceReading {
  device: StoredDevice;
  reading: LiveReading;
}

/**
 * What one device reads and what it is aiming at right now.
 *
 * The configuration fills both halves of the cycle from the controller's single
 * CO2 target, which is a faithful reading of it - so it is here, where the half
 * that is running is known, that the day-only rule applies. Without it a card
 * called a tent's CO2 "in band" at three in the morning against a target the
 * Timeline panel two taps away said it did not have.
 */
export const liveOfDevice = ({ device, reading }: DeviceReading): SpaceLiveDevice => {
  const targets = setpointsOf(device.configuration, reading.isDay, device.state?.hardware);
  const active = targets ? targets[targets.active] : {};
  const aimed = steeredIn(targets?.active ?? 'day');

  return {
    deviceId: device.id,
    values: orderValues(Object.entries(reading.metrics).map(([name, value]) => ({ metric: name as Metric, ...value }))),
    setpoints: aimed.filter(name => active[name] !== undefined).map(name => setpointOf(name, active[name] as number)),
  };
};

/** A target with the band around it, so the figure beside a value and the verdict's "in band" are one judgement. */
export const setpointOf = (name: Metric, value: number | null): CardSetpoint => ({ metric: name, value, band: TARGET_BAND[name] ?? null });

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
