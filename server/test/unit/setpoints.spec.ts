import { setpointsOf } from '@modules/v1/device/setpoints';

/**
 * The targets a device is judged by are the ones it is holding, which its work
 * mode - or an AIR fan's own mode - decides as much as the figures do.
 */
describe('the targets a device holds', () => {
  const FAN = { mode: 0, day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 } };

  it('holds none for an AIR fan at a fixed speed, and the reading it follows otherwise', () => {
    expect(setpointsOf(FAN, true, {}, 'fan')).toBeNull();
    expect(setpointsOf({ ...FAN, mode: 1 }, true, {}, 'fan')?.day).toEqual({ temperature: 25 });
    expect(setpointsOf({ ...FAN, mode: 2 }, false, {}, 'fan')?.night).toEqual({ humidity: 55 });
    expect(setpointsOf({ ...FAN, mode: 3 }, true, {}, 'fan')?.day).toEqual({ temperature: 25, humidity: 60 });
  });

  it('reads a document of another type by its work mode alone', () => {
    // A fan's `mode` key means nothing to a controller's document.
    expect(setpointsOf({ ...FAN, workmode: 'small' }, true, {}, 'controller')?.day).toEqual({ temperature: 25, humidity: 60 });
    expect(setpointsOf({ ...FAN, workmode: 'off' }, true, {}, 'controller')).toBeNull();
  });
});
