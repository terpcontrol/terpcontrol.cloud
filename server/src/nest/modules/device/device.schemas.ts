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

export const addDeviceClassSchema = z
  .object({
    name: requiredString('name'),
    description: requiredString('description'),
    firmware_id: requiredString('firmware_id'),
    concurrent: z.number({ error: 'concurrent must be a number' }),
    maxfails: z.number({ error: 'maxfails must be a number' }),
    beta_firmware_id: z.string().optional(),
    alpha_firmware_id: z.string().optional(),
  })
  .strict();

/**
 * Sent as multipart, with the build's first image alongside the fields, so
 * unknown keys are ignored rather than refused: the uploaded parts share the
 * body with them.
 */
export const addFirmwareSchema = z
  .object({
    name: requiredString('name'),
    version: requiredString('version'),
  })
  .loose();

export type AddDevice = z.infer<typeof addDeviceSchema>;
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;
export type ClaimDevice = z.infer<typeof claimDeviceSchema>;
export type ConfigureDevice = z.infer<typeof configureDeviceSchema>;
export type SetName = z.infer<typeof setNameSchema>;
export type TestDevice = z.infer<typeof testDeviceSchema>;
export type AddDeviceClass = z.infer<typeof addDeviceClassSchema>;
export type AddFirmware = z.infer<typeof addFirmwareSchema>;
