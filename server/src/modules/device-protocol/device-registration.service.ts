import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { MODEL_V1 } from '@database/models';
import { StoredClaimCode } from '@database/schemas/v1/claim-codes.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredDeviceClass } from '@database/schemas/v1/device-classes.schema';
import { hashDevicePassword, verifyDevicePassword } from '@utils/devicepassword';
import { logger } from '@utils/logger';
import { authConfig } from '../../config/configuration';
import { ClaimCodeRequest, RegisterDeviceRequest } from './protocol.schemas';

/**
 * The two things a device does over HTTP before anything else: enrol itself with
 * a cloud, and ask for the code its display shows.
 *
 * Both are frozen, both are unauthenticated in the HTTP sense - a device proves
 * itself with the provisioning password in the body, or not at all - and both
 * answer in the device's own vocabulary.
 */

// The characters a claim code is made of: those that cannot be read as one
// another off a small display - no O or 0, no I, J, L or 1, no Q.
const CLAIM_CODE_ALPHABET = 'ABCDEFGHKMNPRSTUVWXYZ23456789';
const CLAIM_CODE_LENGTH = 6;

/** What `POST /device/register` answers: the build the device is to install. */
export interface DeviceRegistered {
  fw: string;
}

/** What `POST /device/claimcode` answers. */
export interface IssuedClaimCode {
  claim_code: string;
}

@Injectable()
export class DeviceRegistrationService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.deviceClass) private readonly deviceClasses: Model<StoredDeviceClass>,
    @InjectModel(MODEL_V1.claimCode) private readonly claimCodes: Model<StoredClaimCode>,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /**
   * "Change server" on the display. The device sends the identity it was
   * provisioned with, and what it does with the answer is download the build it
   * names - which is what makes it a device of this cloud.
   *
   * Null is every refusal: the display flow cannot tell them apart, and saying
   * which of them it was would help whoever is guessing more than the device.
   */
  public async register(request: RegisterDeviceRequest): Promise<DeviceRegistered | null> {
    logger.info(`Registering device ${request.device_id} of type ${request.device_type}`);

    if (!this.config.enableSelfRegistration) {
      logger.info('REGISTRATION DISABLED');
      return null;
    }
    if (request.registration_password !== this.config.selfRegistrationPassword) {
      logger.info('WRONG PASSWORD');
      return null;
    }

    // Firmware naming a type this server does not know cannot be enrolled: the
    // class is what says which build it should be running.
    const deviceClass = await this.deviceClasses.findOne({ name: request.device_type }).lean();
    if (!deviceClass) {
      logger.info(`Registration refused: no device class named ${request.device_type}`);
      return null;
    }

    const firmwareId = deviceClass.firmwareIds.stable ?? '';
    const existing = await this.devices
      .findOne({ id: request.device_id, type: request.device_type, 'mqtt.username': request.username })
      .select('+mqtt')
      .lean();

    if (existing) {
      return (await this.reRegister(existing, request, deviceClass.id, firmwareId)) ? { fw: firmwareId } : null;
    }

    try {
      // A device that was registered but never claimed is the same hardware
      // coming back, so it makes way rather than colliding on its id.
      await this.devices.deleteOne({ id: request.device_id, ownerId: null });
      await this.devices.create({
        id: request.device_id,
        type: request.device_type,
        classId: deviceClass.id,
        serialNumber: await this.nextSerialNumber(),
        mqtt: { username: request.username, passwordHash: await hashDevicePassword(request.password) },
        firmware: { channel: 'manual', targetId: deviceClass.firmwareIds.stable },
      });

      logger.info(`Registered new device ${request.device_id}`);
      return { fw: firmwareId };
    } catch (error) {
      logger.error(`Device registration failed: ${error}`);
      return null;
    }
  }

  /**
   * The same device enrolling again. It is pinned to the build its class runs
   * rather than to a channel, because whoever is standing in front of it has
   * just told it which cloud to belong to.
   *
   * `claimcode_auth` goes back to off, which is what lets a re-homed device
   * issue a claim code again: it reports the key as `on` at every boot, and the
   * build it is about to install has not booted yet.
   */
  private async reRegister(device: StoredDevice, request: RegisterDeviceRequest, classId: string, firmwareId: string): Promise<boolean> {
    const { matches, legacy } = await verifyDevicePassword(request.password, device.mqtt?.passwordHash ?? '');
    if (!matches) {
      logger.info('WRONG DEVICE PASSWORD');
      return false;
    }

    const update: Record<string, unknown> = {
      classId,
      'firmware.channel': 'manual',
      'firmware.targetId': firmwareId || null,
      'state.hardware.claimcode_auth': 'off',
    };
    // A password stored before hashing was introduced is replaced by a hash the
    // first time it verifies.
    if (legacy) update['mqtt.passwordHash'] = await hashDevicePassword(request.password);

    await this.devices.updateOne({ id: device.id }, { $set: update });
    logger.info(`Re-registered existing device ${device.id}`);
    return true;
  }

  /**
   * The code on the display, which is the whole proof a claim needs. The
   * password is checked only where the device has reported that it wants it
   * checked - firmware that never reported the key predates the check, and
   * refusing those would take the claim code off their display for good.
   */
  public async issueClaimCode(request: ClaimCodeRequest): Promise<IssuedClaimCode | null> {
    const device = await this.devices.findOne({ id: request.device_id }).select('+mqtt').lean();
    if (!device) return null;

    if (device.state.hardware.claimcode_auth === 'on' && !(await this.authenticates(device, request.password))) {
      return null;
    }

    const code = await this.unusedCode();
    // One code per device: asking again replaces the one the display showed.
    await this.claimCodes.updateOne(
      { deviceId: device.id },
      { $set: { code }, $setOnInsert: { id: uuidv4(), createdAt: new Date() } },
      { upsert: true },
    );

    return { claim_code: code };
  }

  private async authenticates(device: StoredDevice, password: string | null | undefined): Promise<boolean> {
    if (typeof password !== 'string' || !device.mqtt) return false;

    const { matches, legacy } = await verifyDevicePassword(password, device.mqtt.passwordHash);
    if (matches && legacy) {
      await this.devices.updateOne({ id: device.id }, { $set: { 'mqtt.passwordHash': await hashDevicePassword(password) } });
    }

    return matches;
  }

  private async unusedCode(): Promise<string> {
    const letter = () => CLAIM_CODE_ALPHABET[Math.floor(Math.random() * CLAIM_CODE_ALPHABET.length)];

    for (;;) {
      const code = Array.from({ length: CLAIM_CODE_LENGTH }, letter).join('');
      if (!(await this.claimCodes.exists({ code }))) return code;
    }
  }

  /** The number printed on the next device's label: one past the highest issued. */
  private async nextSerialNumber(): Promise<number> {
    try {
      const [highest] = await this.devices.aggregate<{ serial: number | null }>([{ $group: { _id: null, serial: { $max: '$serialNumber' } } }]);
      return (Number(highest?.serial) || 0) + 1;
    } catch (error) {
      // A nicety, not the registration: a device with the wrong number on its
      // label is better than one that could not enrol.
      logger.error(`Could not read the highest serial number: ${error}`);
      return 1;
    }
  }
}
