/**
 * What the device services take. Requests are validated against the Zod schemas
 * at the HTTP edge; these describe the shape that reaches the service.
 */
export interface AddDeviceDto {
  class_id: string;
  device_type: string;
}

export interface RegisterDeviceDto {
  registration_password: string;
  device_id: string;
  username: string;
  password: string;
  device_type: string;
}

export interface AddDeviceClassDto {
  name: string;
  description: string;
  firmware_id: string;
  concurrent: number;
  maxfails: number;
  beta_firmware_id?: string;
  alpha_firmware_id?: string;
}

export interface AddDeviceFirmwareDto {
  name: string;
  version: string;
}

export interface ClaimDeviceDto {
  claim_code: string;
}

export interface ConfigureDeviceDto {
  device_id: string;
  configuration: string;
}

export interface SetNameDto {
  device_id: string;
  name: string;
}

/** Every output the test mode drives. */
export interface TestDeviceDto {
  heater: number;
  dehumidifier: number;
  co2: number;
  lights: number;
  fanint: number;
  fanext: number;
  fanbw: number;
}
