import { deviceControlCapability } from './grow-presets';

describe('deviceControlCapability', () => {
  const controller = (sockets?: string) => {
    const hardwareInfo: Record<string, string> = {};
    if (sockets !== undefined) {
      hardwareInfo['sockets'] = sockets;
    }
    return { device_type: 'controller', hardwareInfo: hardwareInfo };
  };

  it('reports full control for a fridge, which switches on its own', () => {
    expect(deviceControlCapability({ device_type: 'fridge', hardwareInfo: {} })).toEqual('full');
  });

  it('reports full control for a controller with a climate socket', () => {
    expect(deviceControlCapability(controller('heater,light'))).toEqual('full');
  });

  it('reports light-only control when just a lamp is paired', () => {
    expect(deviceControlCapability(controller('light'))).toEqual('light_only');
  });

  it('reports monitoring when the controller explicitly has no sockets', () => {
    expect(deviceControlCapability(controller('none'))).toEqual('monitor');
  });

  it('reports unknown when the controller never said what it has', () => {
    // Firmware too old to report its sockets: absent evidence must not be read
    // as control, or the app offers switches the hardware cannot honour.
    expect(deviceControlCapability(controller())).toEqual('unknown');
    expect(deviceControlCapability({ device_type: 'controller' })).toEqual('unknown');
  });
});
