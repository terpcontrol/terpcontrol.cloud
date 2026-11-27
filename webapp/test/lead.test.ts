import { describe, expect, it } from 'vitest';
import { leadOf, leadValuesOf } from '@/screens/control/lead';
import { deviceWith } from './fixtures';

/**
 * Which device Steuerung's top is about where the server names no climate: no
 * device of the place has reported, so none states targets yet. The device list
 * is newest first, and the socket plugged in last must not lead a place whose
 * controller is merely not heard from.
 */
describe('the lead of a place nothing has reported in', () => {
  const never = { configuration: null };
  const plug = deviceWith({ id: 'plug', type: 'plug', ...never });
  const fan = deviceWith({ id: 'fan', type: 'fan', ...never });
  const controller = deviceWith({ id: 'controller', type: 'controller', ...never });
  const fridge = deviceWith({ id: 'fridge', type: 'fridge', ...never });

  it('is the controller or the fridge module, not the socket that joined last', () => {
    expect(leadOf([plug, fan, controller], [])?.id).toBe('controller');
    expect(leadOf([plug, fridge], undefined)?.id).toBe('fridge');
  });

  it('is the first of two climates as they are listed, and the first device where the place holds no climate at all', () => {
    expect(leadOf([plug, fridge, controller], [])?.id).toBe('fridge');
    expect(leadOf([plug, fan], [])?.id).toBe('plug');
  });

  it('is still the climate the server names, where it names one', () => {
    expect(leadOf([plug, controller, fridge], [{ deviceId: 'fridge' }])?.id).toBe('fridge');
  });

  /** A socket that reported first is the server's first climate: it does not lead a place whose controller is not heard yet. */
  it('is the controller never heard, not the socket the server names as a climate beside it', () => {
    expect(leadOf([plug, controller], [{ deviceId: 'plug' }])?.id).toBe('controller');
    expect(leadOf([plug, fan], [{ deviceId: 'fan' }])?.id).toBe('fan');
  });
});

describe('the figures of a place', () => {
  const live = [{ metric: 'temperature' as const, value: 24, measuredAt: '2026-11-14T10:00:00.000Z', state: 'live' as const }];
  const socket = { deviceId: 'plug', values: live };

  it('are none of a socket´s while its controller was never heard', () => {
    const controller = deviceWith({ id: 'controller', type: 'controller', configuration: null, state: { lastSeenAt: null } } as never);
    expect(leadValuesOf(controller, [socket], live, undefined)).toMatchObject({ climate: null, values: [], placeWide: false });
  });

  it('are a heard controller´s own where it holds no climate, never the socket´s beside it', () => {
    const controller = deviceWith({ id: 'controller', type: 'controller', state: { lastSeenAt: '2026-11-14T09:00:00.000Z' } } as never);
    const own = { metric: 'humidity' as const, value: 60, measuredAt: '2026-11-14T09:00:00.000Z', state: 'offline' as const };
    const read = { deviceId: 'controller', pending: null, metrics: { humidity: own }, outputs: {}, setpoints: null };
    expect(leadValuesOf(controller, [socket], live, read).values).toEqual([own]);
  });
});
