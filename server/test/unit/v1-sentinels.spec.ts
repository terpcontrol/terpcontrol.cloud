import { isSentinel, reportsNoSensor } from '@common/v1/sentinels';

/**
 * The figures a device writes to say a sensor is not there, which every read and
 * the ingest both have to recognise. They are the protocol's, so the cases here
 * are the ones `docs/device-protocol.md` §5 names.
 */

describe('a CO2 figure that is not a measurement', () => {
  it('reads the controller´s -1 and the plug´s 0 as "no sensor fitted"', () => {
    expect(isSentinel('co2', -1)).toBe(true);
    expect(isSentinel('co2', 0)).toBe(true);
  });

  it('leaves a concentration a sensor could have measured alone', () => {
    // Outdoor air is around 420 ppm and a dosed tent runs to 1500; nothing in
    // between is ever the sentinel.
    expect(isSentinel('co2', 412)).toBe(false);
    expect(isSentinel('co2', 1500)).toBe(false);
  });

  it('says nothing about any other field', () => {
    // A temperature of zero is a cold morning and a lamp at zero is a lamp that
    // is off - both are readings, and neither is this rule´s business.
    expect(isSentinel('temperature', 0)).toBe(false);
    expect(isSentinel('temperature', -1)).toBe(false);
    expect(isSentinel('out_light', 0)).toBe(false);
  });
});

describe('a CO2 valve that is not there', () => {
  it('reads the promoted -1 the firmware sends for an absent valve', () => {
    // `uint32_t out_co2 = -1` arrives as 0xFFFFFFFF, and a build that typed the
    // field differently would send the negative it means.
    expect(isSentinel('out_co2', 4294967295)).toBe(true);
    expect(isSentinel('out_co2', -1)).toBe(true);
  });

  it('leaves the tick counts a real valve reports', () => {
    // Zero is a valve that stayed shut, which is a state and not an absence.
    expect(isSentinel('out_co2', 0)).toBe(false);
    expect(isSentinel('out_co2', 1)).toBe(false);
    expect(isSentinel('out_co2', 2400)).toBe(false);
  });

  it('says nothing about the other outputs', () => {
    expect(isSentinel('out_heater', 0)).toBe(false);
    expect(isSentinel('out_light', 100)).toBe(false);
  });
});

describe('the hardware report beside it', () => {
  it('takes `co2=off` as the device saying it has no CO2 sensor', () => {
    expect(reportsNoSensor({ co2: 'off' }, 'co2')).toBe(true);
  });

  it('treats an absent key as "the firmware did not say", not as "not fitted"', () => {
    // A plug reports neither, and a build older than the report says nothing at
    // all; hiding a genuine reading on that silence would be the worse mistake,
    // and the value test catches the plug anyway.
    expect(reportsNoSensor({}, 'co2')).toBe(false);
    expect(reportsNoSensor({ claimcode_auth: 'ok', firmware_version: '2.4.1' }, 'co2')).toBe(false);
  });

  it('leaves the metrics the report says nothing about', () => {
    expect(reportsNoSensor({ co2: 'off' }, 'temperature')).toBe(false);
    expect(reportsNoSensor({ co2: 'on' }, 'co2')).toBe(false);
  });
});
