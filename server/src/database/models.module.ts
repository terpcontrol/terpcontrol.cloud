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

/** The model names, so an `@InjectModel` and a registration cannot drift apart. */
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
  exports: [MongooseModule],
})
export class ModelsModule {}
