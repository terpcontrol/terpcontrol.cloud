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
import { rateLimitSchema } from '@database/schemas/rate-limit.schema';
import { recipeSchema } from '@database/schemas/recipe.schema';
import { shareSchema } from '@database/schemas/share.schema';
import { userSchema } from '@database/schemas/users.schema';
import { ImageStore } from './image-store';
import { MODEL } from './models';

export { MODEL } from './models';

const features = [
  { name: MODEL.chartPreset, schema: chartPresetSchema },
  { name: MODEL.claimCode, schema: claimCodeSchema },
  { name: MODEL.device, schema: deviceSchema },
  { name: MODEL.deviceClass, schema: deviceClassSchema },
  { name: MODEL.deviceFirmware, schema: deviceFirmwareSchema },
  { name: MODEL.deviceFirmwareBinary, schema: deviceFirmwareBinarySchema },
  { name: MODEL.deviceLog, schema: deviceLogSchema },
  { name: MODEL.image, schema: imagesSchema },
  { name: MODEL.passwordToken, schema: passwordTokenSchema },
  { name: MODEL.rateLimit, schema: rateLimitSchema },
  { name: MODEL.recipeTemplate, schema: recipeSchema },
  { name: MODEL.share, schema: shareSchema },
  { name: MODEL.user, schema: userSchema },
];

/**
 * Every model in one module rather than a `forFeature` per feature module: the
 * services that read them are not per-feature either - the device service alone
 * touches seven collections - so splitting the registrations up would only
 * spread the same list across the modules that import each other anyway.
 */
@Module({
  imports: [MongooseModule.forFeature(features)],
  // The bytes of a picture live beside the collection that indexes them, so the
  // store belongs with the models rather than with any one feature: the image
  // service writes them, the camera services write them and the cleanup reads
  // what nothing points at any more.
  providers: [ImageStore],
  exports: [MongooseModule, ImageStore],
})
export class ModelsModule {}
