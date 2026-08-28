import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Subject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { mqttConfig } from '../../config/configuration';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mqtt = require('mqtt');

export interface MqttMessage {
  topic: string;
  message: string;
}

/**
 * The server's own connection to the broker. It authenticates with credentials
 * it invents for itself, which the MQTT auth backend recognises as the server's
 * - so there is exactly one of these, and it is a provider so that stays true.
 */
@Injectable()
export class MqttClientService implements OnApplicationShutdown {
  private client;
  private readonly internalUser = uuidv4();
  private readonly internalPassword = uuidv4();

  public readonly messages = new Subject<MqttMessage>();

  constructor(@Inject(mqttConfig.KEY) private readonly config: ConfigType<typeof mqttConfig>) {}

  /**
   * Whether a message published now will reach the broker eventually.
   *
   * Not the same as being connected this instant: a client that has connected
   * once keeps reconnecting on its own and queues what it is given in the
   * meantime (mqtt.js queues QoS 0 by default), so a command sent during a
   * blip arrives when the broker comes back. What cannot be delivered is a
   * message given to no client at all - before the first connection, or after
   * one that never succeeded.
   */
  public get canPublish(): boolean {
    return !!this.client;
  }

  public getUser(): string {
    return this.internalUser;
  }

  public getPassword(): string {
    return this.internalPassword;
  }

  public connect(): Promise<void> {
    const { url, port } = this.config;
    logger.info(`Connecting to the MQTT broker at ${url}:${port}`);

    // A client from an earlier attempt keeps reconnecting on its own, so it has
    // to go before another one is made: otherwise a broker outage leaves one
    // more of them running after every retry.
    this.client?.end(true);

    return new Promise<void>((resolve, reject) => {
      let connected = false;
      const client = mqtt.connect(`mqtt://${url}:${port}`, { username: this.internalUser, password: this.internalPassword });
      this.client = client;

      client.on('connect', () => {
        if (!connected) {
          logger.info('MQTT connected');
          connected = true;
          resolve();
        }
      });

      client.on('error', (error: Error) => {
        logger.error(`MQTT error: ${error}`);

        // Once the handshake has succeeded the client reconnects by itself, and
        // a broker restart is one of these: ending it here would stop it doing
        // so for good, leaving the server with no way to reach any device.
        if (connected) {
          return;
        }

        // Never up: the caller decides when to try again, so this one stops
        // retrying rather than being left running alongside the next attempt -
        // and it is forgotten, so publishing through it says there is no
        // connection instead of dropping the packet in silence.
        reject(error);
        client.end(true);
        if (this.client === client) this.client = undefined;
      });

      client.on('message', (topic: string, message: Buffer) => {
        this.messages.next({ topic, message: String(message) });
      });
    });
  }

  public subscribe(topic: string): Promise<void> {
    if (!this.client) {
      return Promise.reject(new HttpException(503, 'Not connected to the message broker'));
    }

    return new Promise<void>((resolve, reject) => {
      this.client.subscribe(topic, (error: Error | null) => {
        if (error) {
          logger.error(`Could not subscribe to ${topic}: ${error}`);
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Whether the message could be handed to the broker. The connection is made a
   * few seconds after the server starts and can be down afterwards, so there
   * may be nothing to hand it to.
   *
   * It answers rather than throwing, because most callers are timers, stream
   * handlers and socket callbacks with nobody to throw to - a throw there is an
   * unhandled rejection, and it leaves whatever they were in the middle of
   * half-done. A caller serving a request checks the answer and says 503.
   */
  public publish(topic: string, message: string): boolean {
    if (!this.client) {
      logger.error(`Cannot publish to ${topic}: not connected to the message broker`);
      return false;
    }

    this.client.publish(topic, message);
    return true;
  }

  /**
   * Says goodbye rather than dropping the socket: `end(true)` closes without
   * sending a DISCONNECT, which leaves the broker holding the session until the
   * keepalive lapses.
   */
  public onApplicationShutdown(): void {
    this.client?.end(false);
  }
}
