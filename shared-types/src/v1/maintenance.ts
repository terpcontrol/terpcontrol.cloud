/**
 * How much longer than its own window a maintenance window keeps a device's
 * alarms held back.
 *
 * `state.maintenanceUntil` is when the hardware is let go again, and the alarm
 * engine holds every turn on that device for this much longer: a tent whose
 * heater has been off while somebody had their hands in it is not back at its
 * targets the second the door shuts, and an alarm raised on the way back would
 * be about the visit rather than about the tent.
 *
 * It is stated here rather than in the engine because the screens that offer a
 * maintenance window are what a grower reads it off, and every one of them used
 * to name the window alone. A quarter of an hour was promised by the chip, by
 * the panel that asks and by the receipt afterwards, while the quiet in fact ran
 * for twenty-five minutes - so somebody who stepped back out at the sixteenth
 * had ten more in which nothing at all would be raised and no screen said so.
 * One number, read by the engine that keeps it and by the words that promise it.
 *
 * No schema, so a client can import it without pulling zod and the whole
 * contract into its bundle.
 */
export const MAINTENANCE_SETTLE_SECONDS = 10 * 60;
