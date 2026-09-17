import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { chartPresetSchema } from '@database/schemas/chartpreset.schema';
import { claimCodeSchema } from '@database/schemas/claimcode.schema';
import { deviceSchema } from '@database/schemas/device.schema';
import { deviceClassSchema } from '@database/schemas/deviceclass.schema';
import { deviceFirmwareBinarySchema, deviceFirmwareSchema } from '@database/schemas/devicefirmware.schema';
import { deviceLogSchema } from '@database/schemas/devicelog.schema';
import { imagesSchema } from '@database/schemas/images.schema';
import { passwordTokenSchema } from '@database/schemas/password_token.schema';
import { recipeSchema } from '@database/schemas/recipe.schema';
import { shareSchema } from '@database/schemas/share.schema';
import { userSchema } from '@database/schemas/users.schema';
import { alarmRulesSchema } from '@database/schemas/v1/alarm-rules.schema';
import { alertsSchema } from '@database/schemas/v1/alerts.schema';
import { camerasSchema } from '@database/schemas/v1/cameras.schema';
import { chartViewsSchema } from '@database/schemas/v1/chart-views.schema';
import { claimCodesSchema } from '@database/schemas/v1/claim-codes.schema';
import { deviceClassesSchema } from '@database/schemas/v1/device-classes.schema';
import { devicesSchema } from '@database/schemas/v1/devices.schema';
import { entriesSchema } from '@database/schemas/v1/entries.schema';
import { firmwareBinariesSchema } from '@database/schemas/v1/firmware-binaries.schema';
import { firmwaresSchema } from '@database/schemas/v1/firmwares.schema';
import { followsSchema } from '@database/schemas/v1/follows.schema';
import { growsSchema } from '@database/schemas/v1/grows.schema';
import { invitesSchema } from '@database/schemas/v1/invites.schema';
import { mediaSchema } from '@database/schemas/v1/media.schema';
import { membershipsSchema } from '@database/schemas/v1/memberships.schema';
import { migrationsSchema } from '@database/schemas/v1/migrations.schema';
import { notificationLogSchema } from '@database/schemas/v1/notification-log.schema';
import { passwordResetsSchema } from '@database/schemas/v1/password-resets.schema';
import { planTemplatesSchema } from '@database/schemas/v1/plan-templates.schema';
import { plansSchema } from '@database/schemas/v1/plans.schema';
import { plantsSchema } from '@database/schemas/v1/plants.schema';
import { pushSubscriptionsSchema } from '@database/schemas/v1/push-subscriptions.schema';
import { remindersSchema } from '@database/schemas/v1/reminders.schema';
import { schemesSchema } from '@database/schemas/v1/schemes.schema';
import { sessionsSchema } from '@database/schemas/v1/sessions.schema';
import { shareLinksSchema } from '@database/schemas/v1/share-links.schema';
import { spacesSchema } from '@database/schemas/v1/spaces.schema';
import { usersSchema } from '@database/schemas/v1/users.schema';
import { ImageStore } from './image-store';
import { IndexBuildLog } from './index-build-log';
import { MODEL, MODEL_V1 } from './models';

export { MODEL, MODEL_V1 } from './models';

const legacyFeatures = [
  { name: MODEL.chartPreset, schema: chartPresetSchema },
  { name: MODEL.claimCode, schema: claimCodeSchema },
  { name: MODEL.device, schema: deviceSchema },
  { name: MODEL.deviceClass, schema: deviceClassSchema },
  { name: MODEL.deviceFirmware, schema: deviceFirmwareSchema },
  { name: MODEL.deviceFirmwareBinary, schema: deviceFirmwareBinarySchema },
  { name: MODEL.deviceLog, schema: deviceLogSchema },
  { name: MODEL.image, schema: imagesSchema },
  { name: MODEL.passwordToken, schema: passwordTokenSchema },
  { name: MODEL.recipeTemplate, schema: recipeSchema },
  { name: MODEL.share, schema: shareSchema },
  { name: MODEL.user, schema: userSchema },
];

/**
 * The `/v1` collections. They are registered alongside the legacy ones rather
 * than instead of them: the modules that read the old shapes are rewritten one
 * slice at a time, and both layers have to run until the last of them is.
 */
const v1Features = [
  { name: MODEL_V1.alarmRule, schema: alarmRulesSchema },
  { name: MODEL_V1.alert, schema: alertsSchema },
  { name: MODEL_V1.camera, schema: camerasSchema },
  { name: MODEL_V1.chartView, schema: chartViewsSchema },
  { name: MODEL_V1.claimCode, schema: claimCodesSchema },
  { name: MODEL_V1.device, schema: devicesSchema },
  { name: MODEL_V1.deviceClass, schema: deviceClassesSchema },
  { name: MODEL_V1.entry, schema: entriesSchema },
  { name: MODEL_V1.firmware, schema: firmwaresSchema },
  { name: MODEL_V1.firmwareBinary, schema: firmwareBinariesSchema },
  { name: MODEL_V1.follow, schema: followsSchema },
  { name: MODEL_V1.grow, schema: growsSchema },
  { name: MODEL_V1.invite, schema: invitesSchema },
  { name: MODEL_V1.media, schema: mediaSchema },
  { name: MODEL_V1.membership, schema: membershipsSchema },
  { name: MODEL_V1.migration, schema: migrationsSchema },
  { name: MODEL_V1.notificationLogEntry, schema: notificationLogSchema },
  { name: MODEL_V1.passwordReset, schema: passwordResetsSchema },
  { name: MODEL_V1.plan, schema: plansSchema },
  { name: MODEL_V1.planTemplate, schema: planTemplatesSchema },
  { name: MODEL_V1.plant, schema: plantsSchema },
  { name: MODEL_V1.pushSubscription, schema: pushSubscriptionsSchema },
  { name: MODEL_V1.reminder, schema: remindersSchema },
  { name: MODEL_V1.scheme, schema: schemesSchema },
  { name: MODEL_V1.session, schema: sessionsSchema },
  { name: MODEL_V1.shareLink, schema: shareLinksSchema },
  { name: MODEL_V1.space, schema: spacesSchema },
  { name: MODEL_V1.user, schema: usersSchema },
];

/**
 * Two of the `/v1` collections carry a name the legacy layer still owns and
 * still writes into: `users` and `devices`. Their indexes may not be built while
 * that is true - `id`, `email` and `handle` are unique and a legacy document has
 * none of them, so the second one written would be refused.
 *
 * The migration is what separates the two: it renames the old collection aside,
 * and the collection the new model then owns is its own. It builds these indexes
 * itself once it has. When the legacy user and device modules are rewritten and
 * drop out of `legacyFeatures`, this exception goes with them.
 */
export const V1_MODELS_SHARING_A_LEGACY_COLLECTION: string[] = [MODEL_V1.user, MODEL_V1.device];

for (const feature of v1Features) {
  if (V1_MODELS_SHARING_A_LEGACY_COLLECTION.includes(feature.name)) feature.schema.set('autoIndex', false);
}

/**
 * Every model in one module rather than a `forFeature` per feature module: the
 * services that read them are not per-feature either - the device service alone
 * touches seven collections - so splitting the registrations up would only
 * spread the same list across the modules that import each other anyway.
 */
@Module({
  imports: [MongooseModule.forFeature([...legacyFeatures, ...v1Features])],
  // The bytes of a picture live beside the collection that indexes them, so the
  // store belongs with the models rather than with any one feature: the image
  // service writes them, the camera services write them and the cleanup reads
  // what nothing points at any more.
  providers: [ImageStore, IndexBuildLog],
  exports: [MongooseModule, ImageStore],
})
export class ModelsModule {}
