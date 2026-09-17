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
  recipeTemplate: 'RecipeTemplate',
  share: 'Share',
  user: 'User',
} as const;

/**
 * The same for the collections of the `/v1` model, which are registered beside
 * the legacy ones while the modules that read those are rewritten one at a time.
 *
 * The names carry the version because four of them - the user, the device, the
 * claim code and the device class - would otherwise be the name a legacy model
 * already holds, and a connection has one model per name. Which collection each
 * one is stored in is the schema's own to say, and every `v1` schema says it:
 * mongoose would otherwise derive a collection from the name here, prefix and
 * all, and lower-case the camelCase away with it.
 */
export const MODEL_V1 = {
  alarmRule: 'V1AlarmRule',
  alert: 'V1Alert',
  camera: 'V1Camera',
  chartView: 'V1ChartView',
  claimCode: 'V1ClaimCode',
  device: 'V1Device',
  deviceClass: 'V1DeviceClass',
  entry: 'V1Entry',
  firmware: 'V1Firmware',
  firmwareBinary: 'V1FirmwareBinary',
  follow: 'V1Follow',
  grow: 'V1Grow',
  invite: 'V1Invite',
  media: 'V1Media',
  membership: 'V1Membership',
  migration: 'V1Migration',
  notificationLogEntry: 'V1NotificationLogEntry',
  passwordReset: 'V1PasswordReset',
  plan: 'V1Plan',
  planTemplate: 'V1PlanTemplate',
  plant: 'V1Plant',
  pushSubscription: 'V1PushSubscription',
  reminder: 'V1Reminder',
  scheme: 'V1Scheme',
  session: 'V1Session',
  shareLink: 'V1ShareLink',
  space: 'V1Space',
  user: 'V1User',
} as const;
