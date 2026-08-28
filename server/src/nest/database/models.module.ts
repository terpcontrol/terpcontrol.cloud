import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { chartPresetSchema } from '@models/chartpreset.model';
import { claimCodeSchema } from '@models/claimcode.model';
import { deviceSchema } from '@models/device.model';
import { deviceClassSchema } from '@models/deviceclass.model';
import { deviceFirmwareBinarySchema, deviceFirmwareSchema } from '@models/devicefirmware.model';
import { deviceLogSchema } from '@models/devicelog.model';
import { imagesSchema } from '@models/images.model';
import { passwordTokenSchema } from '@models/password_token.model';
import { recipeSchema } from '@models/recipe.model';
import { shareSchema } from '@models/share.model';
import { userSchema } from '@models/users.model';

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
