import { flacheKonfiguration } from '@utils/konfiguration';

describe('A device configuration as setpoint keys', () => {
  it('names a nested setting the way §4.3 spells it', () => {
    const flach = flacheKonfiguration(JSON.stringify({ workmode: 'small', day: { temperature: 25 }, lights: { limit: 100 } }));

    expect(flach).toEqual({ workmode: 'small', 'day.temperature': 25, 'lights.limit': 100 });
  });

  it('keeps a switch as its own word, because false is not zero', () => {
    expect(flacheKonfiguration(JSON.stringify({ co2: { sunsetOff: true }, lights: { maintenanceOn: false } }))).toEqual({
      'co2.sunsetOff': 'true',
      'lights.maintenanceOn': 'false',
    });
  });

  it('leaves out what is not a value', () => {
    const flach = flacheKonfiguration(JSON.stringify({ leer: null, liste: [1, 2], zweig: {}, zahl: 3 }));

    expect(flach).toEqual({ zahl: 3 });
  });

  it('yields nothing rather than half a set for a configuration it cannot read', () => {
    expect(flacheKonfiguration('{ nicht: json')).toEqual({});
    expect(flacheKonfiguration('')).toEqual({});
    expect(flacheKonfiguration(undefined)).toEqual({});
    expect(flacheKonfiguration(null)).toEqual({});
  });

  it('writes no target for a configuration that is only a scalar, since it has no key', () => {
    expect(flacheKonfiguration('25')).toEqual({});
    expect(flacheKonfiguration('"small"')).toEqual({});
  });
});
