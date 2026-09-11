/**
 * The model names, so an `@InjectModel` and a registration cannot drift apart.
 *
 * Their own file rather than the module's: the schemas are registered there and
 * one of them reaches back into the image store, which needs a name to inject a
 * model by. Names that depend on nothing keep that from being a cycle.
 */
export const MODEL = {
  chartPreset: 'ChartPreset',
  claimCode: 'ClaimCode',
  device: 'Device',
  deviceClass: 'DeviceClass',
  deviceFirmware: 'DeviceFirmware',
  deviceFirmwareBinary: 'DeviceFirmwareBinary',
  deviceLog: 'DeviceLog',
  image: 'Image',
  passwordToken: 'PasswordToken',
  rateLimit: 'RateLimit',
  recipeTemplate: 'RecipeTemplate',
  share: 'Share',
  user: 'User',
} as const;
