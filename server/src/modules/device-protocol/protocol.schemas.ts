import { z } from 'zod';

/**
 * The bodies a device sends, exactly as its firmware writes them.
 *
 * They are stated here rather than derived from the `/v1` contract: this is the
 * device's vocabulary - snake_case, the provisioning identity, the password the
 * broker knows it by - and it is frozen by hardware in the field, so it must not
 * move when the contract does.
 */

const required = (name: string) => z.string({ error: `${name} must be a string` });

/** `POST /device/register`, from "change server" on the display or in the phone form. */
export const registerDeviceSchema = z
  .object({
    registration_password: required('registration_password'),
    device_id: required('device_id'),
    username: required('username'),
    password: required('password'),
    device_type: required('device_type'),
  })
  .strict();

/**
 * `POST /device/claimcode`. Loose, and the password optional: builds older than
 * the password check send the device id alone, and a body with a key this server
 * does not know is a newer firmware rather than a bad request.
 */
export const claimCodeSchema = z
  .object({
    device_id: required('device_id').min(1, { error: 'device_id is required' }),
    password: z.string().nullish(),
  })
  .loose();

export type RegisterDeviceRequest = z.infer<typeof registerDeviceSchema>;
export type ClaimCodeRequest = z.infer<typeof claimCodeSchema>;
