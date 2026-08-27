import { MQTT_URL, MQTT_PORT, MQTT_USER, MQTT_PASSWORD } from '@config';
import { Subject } from 'rxjs';
const mqtt = require('mqtt');
import { v4 as uuidv4 } from 'uuid';

export interface MqttMessage {
  topic: string;
  message: string;
}

class MqttClient {
  private client;
  private internal_user;
  private internal_password;

  public getUser() {
    return this.internal_user;
  }
  public getPassword() {
    return this.internal_password;
  }

  public messages: Subject<MqttMessage> = new Subject<MqttMessage>();

  constructor() {
    this.internal_user = uuidv4();
    this.internal_password = uuidv4();
  }

  public connect() {
    const port = MQTT_PORT || '1883';
    console.log('connecting to mqtt server ' + MQTT_URL + ':' + port);

    // A client from an earlier attempt keeps reconnecting on its own, so it has
    // to go before another one is made: otherwise a broker outage leaves one
    // more of them running after every retry.
    this.client?.end(true);

    return new Promise<void>((resolve, reject) => {
      let connected = false;
      const client = mqtt.connect('mqtt://' + MQTT_URL + ':' + port, { username: this.internal_user, password: this.internal_password });
      this.client = client;

      client.on('connect', function () {
        if (!connected) {
          console.log('mqtt connected');
          resolve();
          connected = true;
        }
      });

      client.on('error', error => {
        console.log('mqtt error!');
        console.log(error.toString());

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

      client.on('message', async (topic, message) => {
        this.messages.next({ topic: topic, message: message });
      });
    });
  }

  public subscribe(topic: string) {
    return new Promise<void>((resolve, reject) => {
      this.client.subscribe(topic, function (err) {
        if (!err) {
          resolve();
        } else {
          console.log('err', err);
          reject(err);
        }
      });
    });
  }

  public publish(topic: string, message: string) {
    this.client.publish(topic, message);
  }
}

export const mqttclient = new MqttClient();
