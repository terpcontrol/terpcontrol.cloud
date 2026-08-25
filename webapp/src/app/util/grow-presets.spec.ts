import { deviceCanSwitch, deviceControlCapability } from './grow-presets';

describe('deviceCanSwitch', () => {
  const controller = (sockets?: string) => {
    const hardwareInfo: Record<string, string> = {};
    if (sockets !== undefined) {
      hardwareInfo['sockets'] = sockets;
    }
    return { device_type: 'controller', hardwareInfo: hardwareInfo };
  };

  it('lets a fridge act on everything, because it switches on its own', () => {
    expect(deviceCanSwitch({ device_type: 'fridge', hardwareInfo: {} }, 'humidity')).toBe(true);
    expect(deviceCanSwitch({ device_type: 'fridge', hardwareInfo: {} }, 'light')).toBe(true);
  });

  it('answers per measure, so a heater does not vouch for the humidity', () => {
    const heaterAndLamp = controller('heater,light');
    expect(deviceCanSwitch(heaterAndLamp, 'temperature')).toBe(true);
    expect(deviceCanSwitch(heaterAndLamp, 'light')).toBe(true);
    expect(deviceCanSwitch(heaterAndLamp, 'humidity')).toBe(false);
    expect(deviceCanSwitch(heaterAndLamp, 'co2')).toBe(false);
  });

  it('counts a secondary lamp as light', () => {
    expect(deviceCanSwitch(controller('secondary_light'), 'light')).toBe(true);
  });

  it('says no to everything when the controller explicitly has no sockets', () => {
    expect(deviceCanSwitch(controller('none'), 'temperature')).toBe(false);
    expect(deviceCanSwitch(controller('none'), 'light')).toBe(false);
  });

  it('says unknown to everything when the controller never said what it has', () => {
    // Firmware too old to report its sockets, or one that has not reported yet:
    // absent evidence must not be read as control, or the app offers switches
    // the hardware cannot honour.
    expect(deviceCanSwitch(controller(), 'temperature')).toEqual('unknown');
    expect(deviceCanSwitch({ device_type: 'controller' }, 'humidity')).toEqual('unknown');
  });
});

describe('deviceControlCapability', () => {
  const controller = (sockets: string) => ({ device_type: 'controller', hardwareInfo: { sockets: sockets } });

  it('reports full control for a fridge, which switches on its own', () => {
    expect(deviceControlCapability({ device_type: 'fridge', hardwareInfo: {} })).toEqual('full');
  });

  it('reports light-only control when just a lamp is paired', () => {
    expect(deviceControlCapability(controller('light'))).toEqual('light_only');
  });

  it('reports monitoring when the controller explicitly has no sockets', () => {
    expect(deviceControlCapability(controller('none'))).toEqual('monitor');
  });

  it('reports unknown when the controller never said what it has', () => {
    expect(deviceControlCapability({ device_type: 'controller', hardwareInfo: {} })).toEqual('unknown');
  });
});
