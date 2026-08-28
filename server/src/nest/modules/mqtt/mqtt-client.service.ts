import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Subject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
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
        // retrying rather than being left running alongside the next attempt.
        reject(error);
        client.end(true);
      });

      client.on('message', (topic: string, message: Buffer) => {
        this.messages.next({ topic, message: String(message) });
      });
    });
  }

  public subscribe(topic: string): Promise<void> {
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

  public publish(topic: string, message: string): void {
    this.client.publish(topic, message);
  }

  /** Lets the broker see the disconnect rather than waiting for the keepalive to lapse. */
  public onApplicationShutdown(): void {
    this.client?.end(true);
  }
}
