import { HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthUserDto, AuthVhostDto, AuthResourceDto, AuthTopicDto } from '@modules/mqtt-auth/mqtt-auth.types';
import { sameSecret } from '@common/same-secret';
import { logger } from '@utils/logger';
import { hashDevicePassword, verifyDevicePassword } from '@utils/devicepassword';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { MqttClientService } from '../mqtt/mqtt-client.service';

/**
 * RabbitMQ's authentication backend. What it answers is part of the frozen
 * device protocol; where it reads the credentials from is not, and that is the
 * only thing that changed: a device signs in with `devices.mqtt`, which the
 * contract has no field for and which no read but this one asks for.
 */

/** A device as the broker's questions need it: who it is, and what it signs in with. */
type DeviceCredentials = Pick<StoredDevice, 'id' | 'mqtt'>;

@Injectable()
export class MqttAuthService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly mqtt: MqttClientService,
  ) {}

  public async user(authData: AuthUserDto): Promise<boolean> {
    if (this.isServer(authData) && sameSecret(authData.password ?? '', this.mqtt.password)) {
      return true;
    }

    const device = await this.findDevice(authData.username);
    if (!device?.mqtt) {
      return false;
    }

    const { matches, legacy } = await verifyDevicePassword(authData.password, device.mqtt.passwordHash);
    if (!matches) {
      return false;
    }

    // Records that were plaintext before hashing was introduced are migrated to
    // a hash the first time they authenticate successfully.
    if (legacy) {
      const passwordHash = await hashDevicePassword(authData.password);
      await this.devices.updateOne({ id: device.id }, { $set: { 'mqtt.passwordHash': passwordHash } });
    }

    return true;
  }

  public async vhost(authData: AuthVhostDto): Promise<boolean> {
    if (this.isServer(authData)) {
      return true;
    }

    return (await this.findDevice(authData.username)) !== null && authData.vhost === '/';
  }

  public async topic(authData: AuthTopicDto): Promise<boolean> {
    if (this.isServer(authData)) {
      return true;
    }

    const device = await this.findDevice(authData.username);

    if (!device) {
      return false;
    }
    if (authData.resource !== 'topic') {
      return false;
    }
    if (authData.name !== 'amq.topic') {
      return false;
    }
    if (!authData.routing_key.startsWith(`.devices.${device.id}.`)) {
      logger.info(`mqtt-auth: routing key not allowed: ${authData.routing_key}`);
      throw new HttpException('access denied', 403);
    }

    return true;
  }

  public async resource(authData: AuthResourceDto): Promise<boolean> {
    if (this.isServer(authData)) {
      return true;
    }

    if (!(await this.findDevice(authData.username))) {
      return false;
    }
    if (authData.vhost !== '/') {
      return false;
    }
    if (authData.resource !== 'exchange') {
      if (authData.resource === 'queue' && authData.name === `mqtt-subscription-${authData.client_id}qos0`) {
        // needed for subscriptions
        return true;
      }

      throw new HttpException('access denied', 409);
    }
    if (authData.name !== 'amq.topic') {
      throw new HttpException('access denied', 409);
    }

    return true;
  }

  /** Whether the broker asks about the server's own connection. A body with nothing in it is no question at all. */
  private isServer(body: { username?: string } | null | undefined): boolean {
    if (!body || Object.keys(body).length === 0) throw new HttpException("You're not userData", 400);
    return body.username === this.mqtt.user;
  }

  /** The credentials are excluded from every other read, so this one asks for them by name. */
  private async findDevice(username: string): Promise<DeviceCredentials | null> {
    const device = await this.devices.findOne({ 'mqtt.username': username }).select('id +mqtt').lean<DeviceCredentials>();

    if (!device) {
      logger.info(`mqtt-auth: device not found: ${username}`);
    }
    return device;
  }
}
