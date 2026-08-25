import { MQTT_URL, MQTT_USER, MQTT_PASSWORD } from '@config';
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
    console.log('connecting to mqtt server ' + MQTT_URL + ':1883');
    return new Promise<void>((resolve, reject) => {
      // Set by whichever of connect/error arrives first: the promise settles once.
      let connected = false;
      this.client = mqtt.connect('mqtt://' + MQTT_URL + ':1883', { username: this.internal_user, password: this.internal_password });

      this.client.on('connect', function () {
        if (!connected) {
          console.log('mqtt connected');
          resolve();
          connected = true;
        }
      });

      this.client.on('error', error => {
        // `this` inside a function() here is the mqtt client, not us, so the
        // old `this.client?.end()` closed nothing and every failed attempt left
        // a socket and a reconnect timer behind. A broker that refuses the
        // connection then costs a client per retry until the heap runs out.
        if (connected) {
          return;
        }
        connected = true;
        console.log('mqtt error!');
        console.log(error.toString());
        this.client?.end(true);
        this.client = undefined;
        reject(error);
      });

      this.client.on('message', async (topic, message) => {
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
