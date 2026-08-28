import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Subject } from 'rxjs';
import { mqttclient, MqttMessage } from '../../../databases/mqttclient';

export { MqttMessage };

/**
 * The server's own connection to the broker, as a provider.
 *
 * It delegates to the connection in `databases/mqttclient` rather than opening
 * one of its own, because there must be exactly one: the client authenticates
 * with credentials it invents for itself, and the MQTT auth backend recognises
 * that pair as the server. A second instance would answer `deny` to the
 * server's own connection. The implementation moves in here once the services
 * that still reach for the module-level client are providers themselves.
 */
@Injectable()
export class MqttClientService implements OnApplicationShutdown {
  public get messages(): Subject<MqttMessage> {
    return mqttclient.messages;
  }

  public getUser(): string {
    return mqttclient.getUser();
  }

  public getPassword(): string {
    return mqttclient.getPassword();
  }

  public connect(): Promise<void> {
    return mqttclient.connect();
  }

  public subscribe(topic: string): Promise<void> {
    return mqttclient.subscribe(topic);
  }

  public publish(topic: string, message: string): void {
    mqttclient.publish(topic, message);
  }

  /** Lets the broker see the disconnect rather than waiting for the keepalive to lapse. */
  public onApplicationShutdown(): void {
    mqttclient.end();
  }
}
