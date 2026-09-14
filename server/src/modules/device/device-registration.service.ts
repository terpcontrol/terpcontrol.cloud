import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ClaimCode, Device, DeviceClass } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { hashDevicePassword, verifyDevicePassword } from '@utils/devicepassword';
import { AddDeviceDto, RegisterDeviceDto } from '@modules/device/device.types';
import { authConfig } from '../../config/configuration';
import { MODEL } from '../../database/models.module';

// The characters a claim code is made of: those that cannot be read as one
// another off a small display - no O or 0, no I, J, L or 1, no Q.
const CLAIM_CODE_ALPHABET = 'ABCDEFGHKMNPRSTUVWXYZ23456789';
const CLAIM_CODE_LENGTH = 6;

/** How a device comes to exist and to belong to somebody: enrolment, claim codes, release. */
@Injectable()
export class DeviceRegistrationService {
  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceClass) private readonly deviceClasses: Model<DeviceClass & Document>,
    @InjectModel(MODEL.claimCode) private readonly claimCodes: Model<ClaimCode & Document>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  public async register(info: RegisterDeviceDto): Promise<any> {
    logger.info(`Registering device ${info?.device_id} of type ${info?.device_type}`);

    if (!this.config.enableSelfRegistration) {
      logger.info('REGISTRATION DISABLED');
      return false;
    }
    if (info.registration_password != this.config.selfRegistrationPassword) {
      logger.info('WRONG PASSWORD');
      return false;
    }

    const device_class = await this.deviceClasses.findOne({ name: info.device_type });

    // Firmware naming a type this server does not know cannot be enrolled, and
    // reading the class it did not find is how that used to end as a 500.
    if (!device_class) {
      logger.info(`Registration refused: no device class named ${info.device_type}`);
      return false;
    }

    const existingDevice = await this.devices.findOne({
      device_id: info.device_id,
      username: info.username,
      device_type: info.device_type,
    });

    if (existingDevice) {
      const { matches, legacy } = await verifyDevicePassword(info.password, existingDevice.password);
      if (!matches) {
        logger.info('WRONG DEVICE PASSWORD');
        return false;
      }

      const update: any = {
        $set: {
          'cloudSettings.pendingFirmware': device_class.firmware_id,
          'cloudSettings.firmwareChannel': 'manual',
          'hardwareInfo.claimcode_auth': 'off',
        },
        $unset: { 'cloudSettings.autoFirmwareUpdate': '', pending_firmware: '' },
      };
      // Migrate legacy plaintext records to a hash on successful re-registration.
      if (legacy) {
        update.$set.password = await hashDevicePassword(info.password);
      }
      await this.devices.updateOne({ _id: existingDevice._id }, update);

      logger.info(`Re-registered existing device ${existingDevice.device_id}`);
      return { fw: device_class.firmware_id };
    }

    let serial = 0;

    try {
      serial = await this.nextSerialNumber();
    } catch (err) {
      // The next serial number is a nicety; registration goes on without it.
      logger.error(`Could not read the highest serial number: ${err}`);
      serial = 1;
    }

    const device: Device = {
      device_id: info.device_id,
      username: info.username,
      password: await hashDevicePassword(info.password),
      class_id: device_class.class_id,
      device_type: info.device_type,
      configuration: '',
      owner_id: '',
      serialnumber: serial,
      current_firmware: '',
      lastseen: 0,
      fwupdate_end: 0,
      fwupdate_start: 0,
      cloudSettings: { pendingFirmware: device_class.firmware_id },
    };

    try {
      try {
        await this.devices.deleteOne({ device_id: info.device_id, owner_id: '' }); // remove unclaimed device with same id
      } catch {}
      await this.devices.create(device);
      logger.info(`Registered new device ${device?.device_id}`);

      return { fw: device_class.firmware_id };
    } catch (err) {
      logger.error(`Device registration failed: ${err}`);
      return false;
    }
  }

  public async create(info: AddDeviceDto): Promise<Device> {
    const serial = await this.nextSerialNumber();
    const device_class = await this.deviceClasses.findOne({ class_id: info.class_id });

    // The class decides which firmware the new device is told to run, so there
    // is nothing to create without one - reading it anyway answered 500.
    if (!device_class) {
      throw new HttpException(404, 'Device class not found');
    }

    const plainPassword = uuidv4();
    const device: Device = {
      device_id: uuidv4(),
      username: uuidv4(),
      password: plainPassword,
      class_id: info.class_id,
      device_type: info.device_type,
      configuration: '',
      owner_id: '',
      serialnumber: serial,
      current_firmware: '',
      lastseen: 0,
      fwupdate_end: 0,
      fwupdate_start: 0,
      cloudSettings: { pendingFirmware: device_class.firmware_id },
    };

    await this.devices.create({ ...device, password: await hashDevicePassword(plainPassword) });
    // Return the plaintext password so it can be flashed onto the hardware; only the hash is persisted.
    return device;
  }

  /** The number printed on the next device's label: one past the highest issued. */
  private async nextSerialNumber(): Promise<number> {
    const serialquery = await this.devices.aggregate([
      {
        $group: {
          _id: null,
          serial: { $max: '$serialnumber' },
        },
      },
    ]);

    return (parseInt(serialquery?.[0]?.serial) || 0) + 1;
  }

  private genClaimCode(): string {
    let code = '';

    for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
      code += CLAIM_CODE_ALPHABET[Math.round(Math.random() * (CLAIM_CODE_ALPHABET.length - 1))];
    }

    return code;
  }

  public async getClaimCode(device_id: string, password?: string): Promise<{ claim_code: string } | false> {
    const device = await this.devices.findOne({ device_id: device_id });
    if (!device) {
      return false;
    }

    const requiresAuth = device.hardwareInfo && (device.hardwareInfo as any).claimcode_auth === 'on';
    if (requiresAuth) {
      if (typeof password !== 'string' || typeof device.password !== 'string') {
        return false;
      }
      const { matches, legacy } = await verifyDevicePassword(password, device.password);
      if (!matches) {
        return false;
      }
      if (legacy) {
        await this.devices.updateOne({ _id: device._id }, { $set: { password: await hashDevicePassword(password) } });
      }
    }

    let code = '';
    let doc = null;
    do {
      code = this.genClaimCode();
      doc = await this.claimCodes.findOne({ claim_code: code });
    } while (doc); // ensure unique code

    await this.claimCodes.findOneAndUpdate({ device_id: device_id }, { claim_code: code, device_id: device_id }, { upsert: true });

    return { claim_code: code };
  }

  public async claimDevice(claim_code: string, user_id: string): Promise<string | null> {
    const dev = await this.claimCodes.findOne({ claim_code: claim_code });
    if (dev) {
      logger.info('Claiming device ' + dev.device_id + ' for user ' + user_id);
      // Awaited, or the query is never sent and the code stays claimable.
      await this.claimCodes.deleteOne({ claim_code: claim_code });
      await this.devices.findOneAndUpdate({ device_id: dev.device_id }, { owner_id: user_id });
      return dev.device_id;
    } else {
      logger.info('Invalid claim code ' + claim_code + ' for user ' + user_id);
      return null;
    }
  }

  public async unClaimDevice(device_id: string) {
    await this.devices.findOneAndUpdate({ device_id: device_id }, { owner_id: '' });
  }
}
