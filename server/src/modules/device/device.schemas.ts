import { z } from 'zod';

const requiredString = (name: string) => z.string({ error: `${name} must be a string` });

export const addDeviceSchema = z
  .object({
    class_id: requiredString('class_id'),
    device_type: requiredString('device_type'),
  })
  .strict();

export const registerDeviceSchema = z
  .object({
    registration_password: requiredString('registration_password'),
    device_id: requiredString('device_id'),
    username: requiredString('username'),
    password: requiredString('password'),
    device_type: requiredString('device_type'),
  })
  .strict();

export const claimDeviceSchema = z.object({ claim_code: requiredString('claim_code') }).strict();

export const configureDeviceSchema = z
  .object({
    device_id: requiredString('device_id'),
    configuration: requiredString('configuration'),
  })
  .strict();

export const setNameSchema = z
  .object({
    device_id: requiredString('device_id'),
    name: requiredString('name'),
  })
  .strict();

/** Every output the test mode drives, all of them required. */
export const testDeviceSchema = z
  .object({
    heater: z.number(),
    dehumidifier: z.number(),
    co2: z.number(),
    lights: z.number(),
    fanint: z.number(),
    fanext: z.number(),
    fanbw: z.number(),
  })
  .strict();

const optionalFirmwareId = z
  .string()
  .nullish()
  .transform(value => value ?? undefined);

export const addDeviceClassSchema = z
  .object({
    name: requiredString('name'),
    description: requiredString('description'),
    firmware_id: requiredString('firmware_id'),
    concurrent: z.number({ error: 'concurrent must be a number' }),
    maxfails: z.number({ error: 'maxfails must be a number' }),
    // A class without a beta or alpha build round-trips through the admin page
    // as an explicit null, which the validator this replaces let through; it
    // means the same as leaving the field out.
    beta_firmware_id: optionalFirmwareId,
    alpha_firmware_id: optionalFirmwareId,
  })
  .strict();

/**
 * The settings themselves are the webapp's to shape, and the service fills in
 * what is missing - but they have to be settings: a string reached the code
 * that writes the defaults into them and failed there as a 500.
 */
export const setCloudSettingsSchema = z.object({
  device_id: requiredString('device_id'),
  cloud_settings: z.object({}, { error: 'cloud_settings must be an object' }).loose().nullish(),
});

/**
 * The alarm objects themselves are left unchecked - the webapp owns their shape
 * and grows it - but the list has to be a list: `setDeviceAlarms` iterates it,
 * and used to fail halfway through with a 500 when it was not one.
 */
export const setAlarmsSchema = z.object({
  device_id: requiredString('device_id'),
  alarms: z.array(z.object({}).loose(), { error: 'alarms must be a list' }),
});

/**
 * The duration reaches the device over MQTT before it is written down, so a
 * value that is not a number has to be refused before either happens.
 */
export const maintenanceModeSchema = z.object({
  device_id: requiredString('device_id'),
  duration_minutes: z
    .number({ error: 'duration_minutes must be a number' })
    .nonnegative({ error: 'duration_minutes must not be negative' })
    .nullish()
    .transform(value => value ?? 0),
});

/**
 * The webapp sends this as a multipart form with the build's first image
 * attached, and Fastify puts uploaded parts on the body - so the file is named
 * here rather than the whole payload being left unchecked. The build CLI sends
 * the two fields alone.
 */
export const addFirmwareSchema = z
  .object({
    name: requiredString('name'),
    version: requiredString('version'),
    file: z.unknown().optional(),
  })
  .strict();

export type AddDevice = z.infer<typeof addDeviceSchema>;
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;
export type ClaimDevice = z.infer<typeof claimDeviceSchema>;
export type ConfigureDevice = z.infer<typeof configureDeviceSchema>;
export type SetName = z.infer<typeof setNameSchema>;
export type TestDevice = z.infer<typeof testDeviceSchema>;
export type AddDeviceClass = z.infer<typeof addDeviceClassSchema>;
export type SetAlarms = z.infer<typeof setAlarmsSchema>;
export type SetCloudSettings = z.infer<typeof setCloudSettingsSchema>;
export type MaintenanceMode = z.infer<typeof maintenanceModeSchema>;
export type AddFirmware = z.infer<typeof addFirmwareSchema>;
