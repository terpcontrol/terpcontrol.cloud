/**
 * The model names of the `/v1` collections, so an `@InjectModel` and a
 * registration cannot drift apart.
 *
 * Their own file rather than the module's: the schemas are registered there and
 * one of them reaches back into the image store, which needs a name to inject a
 * model by. Names that depend on nothing keep that from being a cycle.
 *
 * Which collection each model is stored in is the schema's own to say, and every
 * one of them says it: mongoose would otherwise derive a collection from the
 * name here and lower-case the camelCase away with it.
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
