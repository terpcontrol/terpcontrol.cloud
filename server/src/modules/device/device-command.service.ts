import { Injectable } from '@nestjs/common';
import { MAX_SOCKETS, SOCKET_ROLES, SocketRole } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { TestDeviceDto } from '@modules/device/device.types';
import { MqttClientService } from '../mqtt/mqtt-client.service';

// Commands for auxiliary devices managed by the device itself (smart sockets,
// Terp Control Cam). Whitelisted so the endpoint can never publish arbitrary
// actions to the device command topic.
const AUX_COMMAND_ACTIONS = ['socket_remove', 'socket_test', 'socket_set'];

// A role can hold any number of sockets, so a command may name one of them by
// its slot — the position the device reports it at in `socket_listN`. Left
// out, the command applies to the role as a whole, which is what it meant
// when a role could only ever have one socket.
const MAX_SOCKET_SLOT = MAX_SOCKETS - 1;

/**
 * What the cloud tells a device to do right now, over its command topic. Every
 * one of these is published on behalf of a caller that is waiting for an
 * answer, so none of them is stored or retried.
 */
@Injectable()
export class DeviceCommandService {
  constructor(private readonly mqtt: MqttClientService) {}

  /**
   * The device is not going to hear a command the broker could not take, so
   * saying so beats an ok - a client told this knows to try again.
   */
  private requirePublished(device_id: string, payload: Record<string, unknown>): void {
    if (!this.mqtt.publish('/devices/' + device_id + '/command', JSON.stringify(payload))) {
      throw new HttpException(503, 'Not connected to the message broker');
    }
  }

  /** Tells the device to suppress its own alarms; the cloud's are suppressed separately. */
  public activateMaintenanceMode(device_id: string, durationMinutes: number): void {
    logger.info('Activating maintenance mode for device ' + device_id + ' for ' + durationMinutes + ' minutes');

    this.requirePublished(device_id, { action: 'maintenance', durationMinutes });
  }

  public rebootDevice(device_id: string): void {
    logger.info('Rebooting device ' + device_id);

    this.requirePublished(device_id, { action: 'reboot' });
  }

  public testOutputs(device_id: string, outputs: TestDeviceDto): void {
    this.requirePublished(device_id, {
      action: 'test',
      outputs: {
        heater: outputs.heater,
        dehumidifier: outputs.dehumidifier,
        co2: outputs.co2,
        lights: outputs.lights,
        fanint: outputs.fanint,
        fanext: outputs.fanext,
        fanbw: outputs.fanbw,
      },
    });
  }

  public stopTest(device_id: string): void {
    this.requirePublished(device_id, { action: 'stoptest' });
  }

  public sendAuxDeviceCommand(
    device_id: string,
    action: string,
    role: string,
    options?: { ip?: string; user?: string; password?: string; slot?: number | string; append?: boolean | string },
  ): void {
    if (!AUX_COMMAND_ACTIONS.includes(action) || !SOCKET_ROLES.includes(role as SocketRole)) {
      throw new HttpException(400, 'Unknown aux command');
    }

    const payload: Record<string, string | number | boolean> = { action, role };

    if (options?.slot !== undefined && options.slot !== null && options.slot !== '') {
      const slot = Number(options.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SOCKET_SLOT) {
        throw new HttpException(400, 'Invalid socket slot');
      }
      payload['slot'] = slot;
    }

    if (action === 'socket_set') {
      const ip = String(options?.ip ?? '').trim();
      const user = String(options?.user ?? '').trim();
      const password = String(options?.password ?? '').trim();
      // Host or IP the device will call over plain HTTP — keep it simple and bounded.
      if (!ip || ip.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(ip)) {
        throw new HttpException(400, 'Invalid socket address');
      }
      if (user.length > 48 || password.length > 48) {
        throw new HttpException(400, 'Credentials too long');
      }
      payload['ip'] = ip;

      // Credentials are optional. A caller that leaves them out is only
      // re-addressing the socket, and the device then keeps the ones it has —
      // forwarding an empty pair would clear them and lock the device out of a
      // socket that has its own web password. Passing them explicitly replaces
      // them, an empty password meaning "back to the device default".
      if (options?.user !== undefined || options?.password !== undefined) {
        payload['user'] = user;
        payload['password'] = password;
      }

      // Adds a socket to the role instead of configuring the one it has. A
      // caller adding a second heater has no slot to name yet, so it says so
      // here; without it the command keeps its original "configure this role's
      // socket" meaning.
      if (options?.append === true || options?.append === 'true') {
        payload['append'] = true;
      }
    }

    this.requirePublished(device_id, payload);
  }
}
