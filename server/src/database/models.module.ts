import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
import { MODEL_V1 } from './models';

export { MODEL_V1 } from './models';

const features = [
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
 * Two collections keep the name the shapes of the previous release are stored
 * under until the migration has renamed those aside: `users` and `devices`.
 *
 * Their indexes may not be built before that happens - `id`, `email` and
 * `handle` are unique and an unmigrated document has none of them, so the build
 * would be refused and never attempted again. Mongoose starts a model's builds
 * as the model is compiled, which is before the migration runs, so these two say
 * no and the runner builds them itself once the rename has separated the two
 * collections.
 */
export const V1_MODELS_MIGRATED_IN_PLACE: string[] = [MODEL_V1.user, MODEL_V1.device];

/**
 * Every collection this release stores documents in, read off the registrations
 * themselves rather than listed again.
 *
 * It is what the rollback is allowed to drop, and deriving it here is what keeps
 * that list from drifting from where the documents actually land: a collection
 * with no registration is one no service can read or write. Two things are not
 * in it and are handled where they are made - the migration lock, which is the
 * one collection written through the raw driver, and the picture bucket, which
 * the migration never rewrote and the previous release reads by the same ids.
 */
export const V1_COLLECTIONS: string[] = features.map(feature => String(feature.schema.get('collection')));

for (const feature of features) {
  if (V1_MODELS_MIGRATED_IN_PLACE.includes(feature.name)) feature.schema.set('autoIndex', false);
}

/**
 * Every model in one module rather than a `forFeature` per feature module: the
 * services that read them are not per-feature either - the device service alone
 * touches seven collections - so splitting the registrations up would only
 * spread the same list across the modules that import each other anyway.
 */
@Module({
  imports: [MongooseModule.forFeature(features)],
  // The bytes of a picture live beside the collection that indexes them, so the
  // store belongs with the models rather than with any one feature: the media
  // service writes them, the camera services write them and the cleanup reads
  // what nothing points at any more.
  providers: [ImageStore, IndexBuildLog],
  exports: [MongooseModule, ImageStore],
})
export class ModelsModule {}
