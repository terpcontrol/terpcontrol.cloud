/**
 * The values a device writes that are not measurements.
 *
 * The protocol says so outright: `docs/device-protocol.md` §5 records that a
 * controller writes `co2` as `-1` "when no SCD sensor is fitted", and a plug
 * that carries no CO2 hardware at all writes a flat zero. Both are the firmware
 * saying "there is nothing here", in the only vocabulary a numeric field has -
 * and a figure that means "no sensor" is not a reading of the air, however
 * faithfully it was stored.
 *
 * It is stated once, here, because the same sentinel has to be recognised at
 * both ends of the store: the ingest drops it so no new point carries it, and
 * every read of the points already behind it drops it again, so that a card, a
 * chart, an export and an alarm all miss it together rather than one screen
 * being taught the rule and the next not.
 *
 * The test is on the value and not on the device's hardware report. An absent
 * `hardware` key means "firmware too old to say" rather than "not fitted"
 * (`hardware-report.service.ts`), so the report can corroborate the sentinel but
 * can never be the whole of the test; the value always can, because air holds
 * no negative concentration and a room holds none at zero either.
 */

/** The stored field a controller's CO2 sensor is written under. */
const CO2_FIELD = 'co2';

/** And the one its CO2 valve is written under, which carries the same "there is none" the same way. */
export const CO2_OUTPUT_FIELD = 'out_co2';

/**
 * What that `-1` looks like once it has been through the wire.
 *
 * The firmware writes `status["outputs"]["co2"] = hasCo2Sensor() ? state.out_co2
 * : -1` into a `uint32_t`, so the minus one is promoted and arrives as
 * 0xFFFFFFFF. The valve's real value is a count of open ticks since the last
 * publish, reset after every successful one, so a genuine figure is a few
 * thousand at the very most and this one can be nothing else. A build that
 * types the field differently would send the negative it means, so both forms
 * are read as the same statement.
 */
export const NO_CO2_VALVE = 4294967295;

export const isSentinel = (field: string, value: number): boolean =>
  (field === CO2_FIELD && value <= 0) || (field === CO2_OUTPUT_FIELD && (value < 0 || value === NO_CO2_VALVE));

/**
 * The other way a device says a sensor is not there: the `hardware-info` report
 * it sends on its log topic, where `co2=off` means the build looked for an SCD
 * and found none.
 *
 * It corroborates the sentinel rather than replacing it, and it catches the one
 * case the value cannot - a controller that once had a sensor, wrote real
 * figures with it, and has since had it taken out. Those figures are still in
 * the store and a live read looks a month back, so without this the air of a
 * fortnight ago would go on being answered as what the tent reads now.
 */
export const reportsNoSensor = (hardware: Record<string, string>, metric: string): boolean => metric === 'co2' && hardware[CO2_FIELD] === 'off';
