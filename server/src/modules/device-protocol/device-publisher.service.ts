import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceCommand, DeviceConfiguration, SocketRole } from '@fg2/shared-types/v1';
import { HttpException } from '@common/http-exception';
import { isOffline } from '@common/v1/value-age';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { logger } from '@utils/logger';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { decodeCapabilities, decodeSockets } from './sockets';
import { deviceTopic } from './topics';

/**
 * What the cloud says to a device, in the words the firmware understands.
 *
 * Everything outbound goes through here, so the device's vocabulary - its
 * actions, its `durationMinutes`, its seven test outputs, its socket slots -
 * stays inside this module and nothing else composes a payload.
 *
 * Two properties of the protocol shape all of it. **An unknown action is dropped
 * silently**: no error, no log line, no reply, so a caller cannot tell an
 * unimplemented action from one that worked - which is why a command is sent
 * only to a device that announced it understands it. And **nothing is stored or
 * retried**: the caller is waiting, and a device that is not listening was not
 * there to hear it.
 */

/** What a caller learns about a command that went out. MQTT hands back no receipt. */
export interface CommandPublished {
  publishedAt: Date;
  /** Whether the device had been heard from inside the offline window when the command went out. */
  deviceOnline: boolean;
}

/**
 * The outputs a `test` names, which are the fridge's. The server has always sent
 * all seven to every type, and every one of them is sent every time: the
 * firmware reads each field out of the document and a missing one reads as zero,
 * so an output left out of the command is an output switched off.
 */
const TEST_OUTPUTS: Readonly<Record<string, string>> = {
  heater: 'heater',
  dehumidifier: 'dehumidifier',
  co2: 'co2',
  light: 'lights',
  fanInternal: 'fanint',
  fanExternal: 'fanext',
  fanBackwall: 'fanbw',
};

@Injectable()
export class DevicePublisherService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly mqtt: MqttClientService,
  ) {}

  /** Whether a message published now will reach the broker eventually. */
  public get canPublish(): boolean {
    return this.mqtt.canPublish;
  }

  /**
   * A typed command, translated and published. The device is read first, because
   * what it may be sent depends on what it has announced - and because the
   * answer says whether anybody was listening.
   */
  public async command(deviceId: string, command: DeviceCommand): Promise<CommandPublished> {
    const device = await this.devices.findOne({ id: deviceId }).lean();
    if (!device) throw new HttpException(404, 'Device not found');

    const payload = this.payloadFor(device, command);

    // Before the publish rather than after it. The device suppresses its own
    // alarms for as long as it was told and the cloud keeps the same window, so
    // that the window survives a device that never heard - and a broker that
    // could not take the message is exactly such a device.
    if (command.kind === 'maintenance') await this.noteMaintenance(deviceId, command.forSeconds);

    this.publishCommand(deviceId, payload);

    return { publishedAt: new Date(), deviceOnline: !isOffline(device.state.lastSeenAt) };
  }

  /**
   * Quiet on this device for a while, whether or not it hears about it.
   *
   * Somebody with their hands in a tent is what this is for, and the diary line
   * they wrote must not fail because the broker is down - so unlike the command
   * route, which has a caller waiting to be told whether anybody was listening,
   * a publish that could not go out is left at the window the cloud keeps.
   */
  public async startMaintenance(deviceId: string, forSeconds: number): Promise<void> {
    await this.noteMaintenance(deviceId, forSeconds);
    this.mqtt.publish(deviceTopic(deviceId, 'command'), JSON.stringify(maintenancePayload(forSeconds)));
  }

  private async noteMaintenance(deviceId: string, forSeconds: number): Promise<void> {
    const until = new Date(Date.now() + forSeconds * 1000);
    await this.devices.updateOne({ id: deviceId }, { $set: { 'state.maintenanceUntil': until } });
  }

  /**
   * Removing a socket and testing one are the two commands that are not a
   * `DeviceCommand`: they address a row of the reported table and carry nothing
   * else. The firmware names a socket by its role and narrows it with the slot,
   * so a caller naming the slot has the role read back out of the table.
   *
   * A role addresses every socket of it, which is what a command could mean back
   * when a role held one - and the only thing it can mean on a build that
   * reports no table, where every row answers to the slot -1.
   */
  public async socketAction(deviceId: string, action: 'socket_remove' | 'socket_test', target: number | SocketRole): Promise<CommandPublished> {
    const device = await this.devices.findOne({ id: deviceId }).lean();
    if (!device) throw new HttpException(404, 'Device not found');

    if (typeof target === 'string') {
      this.publishCommand(deviceId, { action, role: target });
      return { publishedAt: new Date(), deviceOnline: !isOffline(device.state.lastSeenAt) };
    }

    // Every row of a build that reports no table answers to the slot -1, so the
    // slot names none of them and the role is the only address there is.
    if (target < 0) throw new HttpException(400, 'This device reports no socket table, so a socket is addressed by its role');

    const socket = decodeSockets(device.state.hardware).find(candidate => candidate.slot === target);
    if (!socket) throw new HttpException(404, 'The device reports no socket in that slot');

    this.publishCommand(deviceId, { action, role: socket.role, slot: target });

    return { publishedAt: new Date(), deviceOnline: !isOffline(device.state.lastSeenAt) };
  }

  /**
   * The configuration document, on its way back to the device that owns it. The
   * server stores a copy and hands it back; what it means is the device's own
   * business, and a key the device does not know is ignored and disappears.
   */
  public configuration(deviceId: string, configuration: DeviceConfiguration): boolean {
    return this.mqtt.publish(deviceTopic(deviceId, 'configuration'), JSON.stringify(configuration));
  }

  /** The build a device is to install, as a bare string rather than JSON. */
  public firmware(deviceId: string, firmwareId: string): boolean {
    return this.mqtt.publish(deviceTopic(deviceId, 'firmware'), firmwareId);
  }

  /** One frame into the tunnel a device holds open. */
  public tunnelWrite(deviceId: string, message: string): boolean {
    return this.mqtt.publish(deviceTopic(deviceId, 'tunnel_write'), message);
  }

  /**
   * Asks the controller for a still now. It answers with the picture in
   * fragments on `image`, and with nothing at all when it cannot.
   */
  public captureStill(deviceId: string): boolean {
    return this.mqtt.publish(deviceTopic(deviceId, 'command'), JSON.stringify({ action: 'cam_capture' }));
  }

  private publishCommand(deviceId: string, payload: Record<string, unknown>): void {
    logger.info(`Commanding device ${deviceId}: ${payload.action}`);

    // The device is not going to hear a command the broker could not take, so
    // saying so beats an ok - a client told this knows to try again.
    if (!this.mqtt.publish(deviceTopic(deviceId, 'command'), JSON.stringify(payload))) {
      throw new HttpException(503, 'Not connected to the message broker');
    }
  }

  private payloadFor(device: StoredDevice, command: DeviceCommand): Record<string, unknown> {
    switch (command.kind) {
      case 'reboot':
        return { action: 'reboot' };
      case 'maintenance':
        return maintenancePayload(command.forSeconds);
      case 'test':
        return {
          action: 'test',
          outputs: Object.fromEntries(Object.entries(TEST_OUTPUTS).map(([metric, output]) => [output, command.outputs[metric] ?? 0])),
        };
      case 'stop_test':
        return { action: 'stoptest' };
      case 'capture_still':
        return { action: 'cam_capture' };
      case 'socket_override':
        return this.overridePayload(device, command);
      case 'socket_set':
        return this.socketSetPayload(device, command);
    }
  }

  private overridePayload(device: StoredDevice, command: Extract<DeviceCommand, { kind: 'socket_override' }>): Record<string, unknown> {
    const capabilities = decodeCapabilities(device.state.hardware);
    const output = command.subject.type === 'output';

    this.require(output ? capabilities.lightOverride : capabilities.socketOverride, 'overriding an output');

    return {
      action: 'socket_override',
      ...(output ? { output: command.subject.id } : { slot: Number(command.subject.id) }),
      state: command.state,
      seconds: command.forSeconds,
    };
  }

  private socketSetPayload(device: StoredDevice, command: Extract<DeviceCommand, { kind: 'socket_set' }>): Record<string, unknown> {
    const capabilities = decodeCapabilities(device.state.hardware);
    this.require(capabilities.roles.includes(command.role), `the role ${command.role || 'unassigned'}`);
    if (command.timer) this.require(capabilities.socketTimer, 'a socket timer');

    return {
      action: 'socket_set',
      role: command.role,
      ip: command.address,
      // No slot adds a socket to the role instead of configuring the one it has,
      // which is what a caller pairing a second heater means: it has no slot to
      // name yet.
      ...(command.slot === null ? { append: true } : { slot: command.slot }),
      // Credentials are only touched when the command carries them. Leaving them
      // out re-addresses the socket and keeps whatever it had, which is what
      // stops a re-addressing from locking the device out of a socket with its
      // own web password; an empty password puts it back on the default.
      ...(command.credentials ? { user: command.credentials.username, password: command.credentials.password } : {}),
      ...(command.timer ? { timer: { onS: command.timer.onSeconds, everyS: command.timer.everySeconds } } : {}),
    };
  }

  /**
   * A device that has not announced something is never sent it: old firmware
   * drops what it does not know without a word, and the version it reports is
   * the build's uuid, which cannot be compared against anything.
   */
  private require(announced: boolean, what: string): void {
    if (!announced) {
      throw new HttpException(409, `This device has not announced that it understands ${what}`);
    }
  }
}

/** The device counts maintenance in whole minutes, so that is what it is told. */
const maintenancePayload = (forSeconds: number): Record<string, unknown> => ({
  action: 'maintenance',
  durationMinutes: Math.round(forSeconds / 60),
});
