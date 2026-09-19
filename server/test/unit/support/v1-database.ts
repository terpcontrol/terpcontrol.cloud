import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule, alarmRulesSchema } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert, alertsSchema } from '@database/schemas/v1/alerts.schema';
import { CameraDocument, camerasSchema } from '@database/schemas/v1/cameras.schema';
import { ChartViewDocument, chartViewsSchema } from '@database/schemas/v1/chart-views.schema';
import { StoredClaimCode, claimCodesSchema } from '@database/schemas/v1/claim-codes.schema';
import { StoredDeviceClass, deviceClassesSchema } from '@database/schemas/v1/device-classes.schema';
import { StoredDevice, devicesSchema } from '@database/schemas/v1/devices.schema';
import { EntryDocument, entriesSchema } from '@database/schemas/v1/entries.schema';
import { StoredFirmware, firmwaresSchema } from '@database/schemas/v1/firmwares.schema';
import { FollowDocument, followsSchema } from '@database/schemas/v1/follows.schema';
import { GrowDocument, growsSchema } from '@database/schemas/v1/grows.schema';
import { InviteDocument, invitesSchema } from '@database/schemas/v1/invites.schema';
import { MediaDocument, mediaSchema } from '@database/schemas/v1/media.schema';
import { MembershipDocument, membershipsSchema } from '@database/schemas/v1/memberships.schema';
import { StoredNotificationLogEntry, notificationLogSchema } from '@database/schemas/v1/notification-log.schema';
import { StoredPasswordReset, passwordResetsSchema } from '@database/schemas/v1/password-resets.schema';
import { StoredPlanTemplate, planTemplatesSchema } from '@database/schemas/v1/plan-templates.schema';
import { StoredPlan, plansSchema } from '@database/schemas/v1/plans.schema';
import { PlantDocument, plantsSchema } from '@database/schemas/v1/plants.schema';
import { StoredPushSubscription, pushSubscriptionsSchema } from '@database/schemas/v1/push-subscriptions.schema';
import { ReminderDocument, remindersSchema } from '@database/schemas/v1/reminders.schema';
import { StoredSession, sessionsSchema } from '@database/schemas/v1/sessions.schema';
import { SchemeDocument, schemesSchema } from '@database/schemas/v1/schemes.schema';
import { ShareLinkDocument, shareLinksSchema } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument, spacesSchema } from '@database/schemas/v1/spaces.schema';
import { StoredUser, usersSchema } from '@database/schemas/v1/users.schema';

/**
 * A real MongoDB holding the `/v1` collections, for the services that decide by
 * querying them. `access()` is a handful of lookups over five collections and a
 * `$in` across the spaces a membership covers; stubbing those would only ever
 * confirm that the spec and the service agree on what to stub.
 */
export interface V1TestDatabase {
  connection: Connection;
  spaces: Model<SpaceDocument>;
  grows: Model<GrowDocument>;
  plants: Model<PlantDocument>;
  devices: Model<StoredDevice>;
  deviceClasses: Model<StoredDeviceClass>;
  firmwares: Model<StoredFirmware>;
  cameras: Model<CameraDocument>;
  claimCodes: Model<StoredClaimCode>;
  entries: Model<EntryDocument>;
  media: Model<MediaDocument>;
  memberships: Model<MembershipDocument>;
  invites: Model<InviteDocument>;
  plans: Model<StoredPlan>;
  alarmRules: Model<StoredAlarmRule>;
  alerts: Model<StoredAlert>;
  reminders: Model<ReminderDocument>;
  chartViews: Model<ChartViewDocument>;
  schemes: Model<SchemeDocument>;
  planTemplates: Model<StoredPlanTemplate>;
  pushSubscriptions: Model<StoredPushSubscription>;
  notificationLog: Model<StoredNotificationLogEntry>;
  follows: Model<FollowDocument>;
  shareLinks: Model<ShareLinkDocument>;
  users: Model<StoredUser>;
  sessions: Model<StoredSession>;
  passwordResets: Model<StoredPasswordReset>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const startV1TestDatabase = async (): Promise<V1TestDatabase> => {
  const server = await MongoMemoryServer.create();
  const connection = mongoose.createConnection(server.getUri('v1-unit-spec'));
  await connection.asPromise();

  return {
    connection,
    spaces: connection.model<SpaceDocument>(MODEL_V1.space, spacesSchema),
    grows: connection.model<GrowDocument>(MODEL_V1.grow, growsSchema),
    plants: connection.model<PlantDocument>(MODEL_V1.plant, plantsSchema),
    devices: connection.model<StoredDevice>(MODEL_V1.device, devicesSchema),
    deviceClasses: connection.model<StoredDeviceClass>(MODEL_V1.deviceClass, deviceClassesSchema),
    firmwares: connection.model<StoredFirmware>(MODEL_V1.firmware, firmwaresSchema),
    cameras: connection.model<CameraDocument>(MODEL_V1.camera, camerasSchema),
    claimCodes: connection.model<StoredClaimCode>(MODEL_V1.claimCode, claimCodesSchema),
    entries: connection.model<EntryDocument>(MODEL_V1.entry, entriesSchema),
    media: connection.model<MediaDocument>(MODEL_V1.media, mediaSchema),
    memberships: connection.model<MembershipDocument>(MODEL_V1.membership, membershipsSchema),
    invites: connection.model<InviteDocument>(MODEL_V1.invite, invitesSchema),
    plans: connection.model<StoredPlan>(MODEL_V1.plan, plansSchema),
    alarmRules: connection.model<StoredAlarmRule>(MODEL_V1.alarmRule, alarmRulesSchema),
    alerts: connection.model<StoredAlert>(MODEL_V1.alert, alertsSchema),
    reminders: connection.model<ReminderDocument>(MODEL_V1.reminder, remindersSchema),
    chartViews: connection.model<ChartViewDocument>(MODEL_V1.chartView, chartViewsSchema),
    schemes: connection.model<SchemeDocument>(MODEL_V1.scheme, schemesSchema),
    planTemplates: connection.model<StoredPlanTemplate>(MODEL_V1.planTemplate, planTemplatesSchema),
    pushSubscriptions: connection.model<StoredPushSubscription>(MODEL_V1.pushSubscription, pushSubscriptionsSchema),
    notificationLog: connection.model<StoredNotificationLogEntry>(MODEL_V1.notificationLogEntry, notificationLogSchema),
    follows: connection.model<FollowDocument>(MODEL_V1.follow, followsSchema),
    shareLinks: connection.model<ShareLinkDocument>(MODEL_V1.shareLink, shareLinksSchema),
    users: connection.model<StoredUser>(MODEL_V1.user, usersSchema),
    sessions: connection.model<StoredSession>(MODEL_V1.session, sessionsSchema),
    passwordResets: connection.model<StoredPasswordReset>(MODEL_V1.passwordReset, passwordResetsSchema),
    reset: async () => {
      const collections = await connection.db!.collections();
      await Promise.all(collections.map(collection => collection.deleteMany({})));
    },
    stop: async () => {
      await connection.close();
      await server.stop();
    },
  };
};
