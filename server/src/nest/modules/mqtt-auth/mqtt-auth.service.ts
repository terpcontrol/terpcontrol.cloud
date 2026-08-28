import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { HttpException } from '@exceptions/HttpException';
import { AuthUserDto, AuthVhostDto, AuthResourceDto, AuthTopicDto } from '@dtos/mqttauth.dto';
import { Device } from '@fg2/shared-types';
import { isEmpty } from '@utils/util';
import { logger } from '@utils/logger';
import { hashDevicePassword, verifyDevicePassword } from '@utils/devicepassword';
import { MODEL } from '../../database/models.module';
import { MqttClientService } from '../mqtt/mqtt-client.service';

@Injectable()
export class MqttAuthService {
  constructor(@InjectModel(MODEL.device) private readonly devices: Model<Device & Document>, private readonly mqtt: MqttClientService) {}

  public async user(authData: AuthUserDto): Promise<boolean> {
    if (isEmpty(authData)) {
      throw new HttpException(400, "You're not userData");
    }

    if (authData.username == this.mqtt.getUser() && authData.password == this.mqtt.getPassword()) {
      return true;
    }

    const findDevice = await this.devices.findOne({ username: authData.username });

    if (!findDevice) {
      logger.info(`mqtt-auth: device not found: ${authData.username}`);
      return false;
    }

    const { matches, legacy } = await verifyDevicePassword(authData.password, findDevice.password);
    if (!matches) {
      return false;
    }

    // Migrate legacy plaintext records to a hash once they authenticate successfully.
    if (legacy) {
      const hashed = await hashDevicePassword(authData.password);
      await this.devices.updateOne({ username: findDevice.username, password: findDevice.password }, { $set: { password: hashed } });
    }

    return true;
  }

  public async vhost(authData: AuthVhostDto): Promise<boolean> {
    if (isEmpty(authData)) {
      throw new HttpException(400, "You're not userData");
    }

    if (authData.username == this.mqtt.getUser()) {
      return true;
    }

    const findDevice = await this.devices.findOne({ username: authData.username });

    if (!findDevice) {
      logger.info(`mqtt-auth: device not found: ${authData.username}`);
      return false;
    }

    return authData.vhost === '/';
  }

  public async topic(authData: AuthTopicDto): Promise<boolean> {
    if (isEmpty(authData)) {
      throw new HttpException(400, "You're not userData");
    }

    if (authData.username == this.mqtt.getUser()) {
      return true;
    }

    const findDevice = await this.devices.findOne({ username: authData.username });

    if (!findDevice) {
      logger.info(`mqtt-auth: device not found: ${authData.username}`);
      return false;
    }
    if (authData.resource !== 'topic') {
      return false;
    }
    if (authData.name !== 'amq.topic') {
      return false;
    }
    if (!authData.routing_key.startsWith(`.devices.${findDevice.device_id}.`)) {
      logger.info(`mqtt-auth: routing key not allowed: ${authData.routing_key}`);
      throw new HttpException(403, 'access denied');
    }

    return true;
  }

  public async resource(authData: AuthResourceDto): Promise<boolean> {
    if (isEmpty(authData)) {
      throw new HttpException(400, "You're not userData");
    }

    if (authData.username == this.mqtt.getUser()) {
      return true;
    }

    const findDevice = await this.devices.findOne({ username: authData.username });

    if (!findDevice) {
      logger.info(`mqtt-auth: device not found: ${authData.username}`);
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

      throw new HttpException(409, 'access denied');
    }
    if (authData.name !== 'amq.topic') {
      throw new HttpException(409, 'access denied');
    }

    return true;
  }
}

export default MqttAuthService;
