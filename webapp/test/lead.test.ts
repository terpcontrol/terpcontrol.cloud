import { describe, expect, it } from 'vitest';
import { leadOf } from '@/screens/control/lead';
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
});
