import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceCommand, DeviceConfiguration, SocketRole } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES, TIMED_SOCKET_ROLES } from '@fg2/shared-types/v1-schemas';
import { badRequest, conflict, notFound, serviceUnavailable, unprocessable } from '@common/v1/problem';
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
    if (!device) throw notFound('device_not_found', 'There is no device with that id.');

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

  /**
   * What is left of a window the cloud already keeps, told to a device that may
   * not have heard it. Whole minutes, rounded down, so the device never holds
   * its outputs past the end the screens name; nothing is stored, because the
   * window is already.
   */
  public repeatMaintenance(deviceId: string, forSeconds: number): void {
    this.mqtt.publish(deviceTopic(deviceId, 'command'), JSON.stringify({ action: 'maintenance', durationMinutes: Math.floor(forSeconds / 60) }));
  }

  /**
   * Ending a window only moves one that is open. A device that was not in
   * maintenance has nothing to come out of, and stamping the end would start
   * the settling hold on its alarms - ten minutes of quiet after a visit that
   * never happened, and a page saying it had come out of maintenance.
   */
  private async noteMaintenance(deviceId: string, forSeconds: number): Promise<void> {
    const now = new Date();
    const until = new Date(now.getTime() + forSeconds * 1000);
    const open = forSeconds > 0 ? {} : { 'state.maintenanceUntil': { $gt: now } };
    await this.devices.updateOne({ id: deviceId, ...open }, { $set: { 'state.maintenanceUntil': until } });
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
    if (!device) throw notFound('device_not_found', 'There is no device with that id.');

    const sockets = decodeSockets(device.state.hardware);

    if (typeof target === 'string') {
      // A role is only an address where the device reports one under it.
      // Anything else would be a command the firmware drops without a word.
      if (!sockets.some(socket => socket.role === target)) {
        throw notFound('socket_unknown', `This device reports no socket with the role ${target || 'unassigned'}.`);
      }

      this.publishCommand(deviceId, { action, role: target });
      return { publishedAt: new Date(), deviceOnline: !isOffline(device.state.lastSeenAt) };
    }

    // Every row of a build that reports no table answers to the slot -1, so the
    // slot names none of them and the role is the only address there is.
    if (target < 0) {
      throw badRequest('no_socket_table', 'This device reports no socket table, so a socket is addressed by its role.');
    }

    const socket = sockets.find(candidate => candidate.slot === target);
    if (!socket) throw notFound('socket_unknown', `This device reports no socket in slot ${target}.`);

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
      throw serviceUnavailable('broker_unavailable', 'The message broker could not take the command, so the device did not hear it. Try again.');
    }
  }

  private payloadFor(device: StoredDevice, command: DeviceCommand): Record<string, unknown> {
    switch (command.kind) {
      case 'reboot':
        return { action: 'reboot' };
      case 'maintenance':
        return maintenancePayload(command.forSeconds);
      case 'capture_still':
        this.mustHost(device, 'no camera to take a still with');
        return { action: 'cam_capture' };
      case 'socket_override':
        this.mustHost(device, command.subject.type === 'output' ? 'no way to hold its light output on command' : 'no smart sockets');
        return this.overridePayload(device, command);
      case 'socket_set':
        this.mustHost(device, 'no smart sockets');
        return this.socketSetPayload(device, command);
    }
  }

  /**
   * Only the controller and the fridge take these commands. Anything else
   * drops them without a word, so a 202 saying the device was listening would
   * read as delivered - and no build of it will ever take them, which is why
   * this is not the "needs newer firmware" refusal.
   */
  private mustHost(device: StoredDevice, lacking: string): void {
    if (!SOCKET_HOST_TYPES.includes(device.type)) {
      throw conflict('not_for_this_device', `A ${device.type} has ${lacking} in any build.`);
    }
  }

  /**
   * Holding a socket, or the module's own light output, for a while.
   *
   * The only output that takes one is `light`, and a slot is addressed by the
   * table the device reported: the firmware refuses a slot outside it, and a
   * refusal it never sends back is indistinguishable from a command that
   * worked, so the row is checked here instead.
   */
  private overridePayload(device: StoredDevice, command: Extract<DeviceCommand, { kind: 'socket_override' }>): Record<string, unknown> {
    const capabilities = decodeCapabilities(device.state.hardware);
    const clearing = command.state === 'auto';

    // `auto` ends an override rather than being one, which is why it carries no
    // duration; everything else has to say how long, because a socket held with
    // no end is what the expiry exists to make impossible.
    if (!clearing && command.forSeconds <= 0) {
      throw unprocessable('override_without_end', 'An override says how long it holds; only handing the socket back carries no duration.');
    }

    if (command.subject.type === 'output') {
      this.require(capabilities.lightOverride, 'overriding its own light output');
      if (command.subject.id !== 'light') {
        throw badRequest('output_not_overridable', `Only the light output takes an override, not ${command.subject.id}.`);
      }

      return { action: 'socket_override', output: command.subject.id, state: command.state, seconds: command.forSeconds };
    }

    this.require(capabilities.socketOverride, 'holding a socket on or off');
    const slot = this.slotOf(device, command.subject.id);

    return { action: 'socket_override', slot, state: command.state, seconds: command.forSeconds };
  }

  /** The row a command names, as the device reports it. */
  private slotOf(device: StoredDevice, id: string): number {
    const slot = Number(id);
    if (!Number.isInteger(slot) || slot < 0) {
      throw badRequest('socket_unknown', 'A socket is named by the slot it sits in, which is a row of the table the device reports.');
    }

    const socket = decodeSockets(device.state.hardware).find(candidate => candidate.slot === slot);
    if (!socket) throw notFound('socket_unknown', `This device reports no socket in slot ${slot}.`);

    return slot;
  }

  /**
   * Pairing a socket by its address, giving it a role, or giving a timed role
   * its timer. The role has to be one this build takes and the timer one it
   * consults, because a role it does not know is dropped when the table is
   * loaded and a timer on any other role is stored and never read.
   */
  private socketSetPayload(device: StoredDevice, command: Extract<DeviceCommand, { kind: 'socket_set' }>): Record<string, unknown> {
    const capabilities = decodeCapabilities(device.state.hardware);

    // The unassigned role is the empty string, which a comma-separated list
    // cannot carry, so no build ever announces it and every build takes it.
    if (command.role !== '') this.require(capabilities.roles.includes(command.role), `the role ${command.role}`);
    if (command.slot !== null) this.slotOf(device, String(command.slot));

    if (command.timer) {
      this.require(capabilities.socketTimer, 'a socket timer');
      if (!TIMED_SOCKET_ROLES.includes(command.role)) {
        throw unprocessable(
          'timer_not_for_role',
          `A ${command.role || 'unassigned'} socket follows the controller rather than a timer. Only ${TIMED_SOCKET_ROLES.join(' and ')} run on one.`,
        );
      }
    }

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
   * the build's uuid, which cannot be compared against anything. So the reason
   * a person is given is the only one there is - the device needs a newer
   * firmware before this switch does anything.
   */
  private require(announced: boolean, what: string): void {
    if (!announced) {
      throw conflict('capability_not_announced', `This device has not announced that it understands ${what}. It needs a newer firmware.`);
    }
  }
}

/** The device counts maintenance in whole minutes, so that is what it is told. */
const maintenancePayload = (forSeconds: number): Record<string, unknown> => ({
  action: 'maintenance',
  durationMinutes: Math.round(forSeconds / 60),
});
