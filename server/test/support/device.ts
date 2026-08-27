import { connect, MqttClient } from 'mqtt';
import { anonymous, context, Session, unique } from './api';

export type DeviceType = 'fridge' | 'controller' | 'plug' | 'fan' | 'light';

export interface DeviceCredentials {
  deviceId: string;
  username: string;
  password: string;
  deviceType: DeviceType;
}

/** Registers a device the way firmware does on first boot. */
export const registerDevice = async (deviceType: DeviceType = 'fridge'): Promise<DeviceCredentials> => {
  const credentials: DeviceCredentials = {
    deviceId: unique(`sim-${deviceType}`),
    username: unique('device-user'),
    password: unique('device-pass'),
    deviceType,
  };

  await anonymous()
    .post('/device/register')
    .send({
      registration_password: context.selfRegistrationPassword,
      device_id: credentials.deviceId,
      username: credentials.username,
      password: credentials.password,
      device_type: credentials.deviceType,
    })
    .expect(201);

  return credentials;
};

/** Registers a device and claims it for the session's user. */
export const provisionDevice = async (session: Session, deviceType: DeviceType = 'fridge'): Promise<DeviceCredentials> => {
  const credentials = await registerDevice(deviceType);

  const claimCode = await anonymous().post('/device/claimcode').send({ device_id: credentials.deviceId }).expect(200);

  await session.client.post('/device').send({ claim_code: claimCode.body.claim_code }).expect(200);

  return credentials;
};

export interface ObservedMessage {
  topic: string;
  payload: string;
  receivedAt: number;
}

/**
 * Stands in for firmware on the MQTT bus: publishes what a device publishes and
 * records what the server sends back, so specs can assert on both directions.
 */
export class DeviceSimulator {
  private client: MqttClient;
  public readonly received: ObservedMessage[] = [];
  private waiters: Array<{ predicate: (message: ObservedMessage) => boolean; resolve: (message: ObservedMessage) => void }> = [];

  constructor(public readonly credentials: DeviceCredentials) {}

  public async connect(): Promise<this> {
    this.client = connect(`mqtt://127.0.0.1:${context.mqttPort}`, {
      username: this.credentials.username,
      password: this.credentials.password,
      clientId: `sim-${this.credentials.deviceId}`,
    });

    await new Promise<void>((resolve, reject) => {
      this.client.once('connect', () => resolve());
      this.client.once('error', reject);
    });

    this.client.on('message', (topic, payload) => {
      const message = { topic, payload: payload.toString(), receivedAt: Date.now() };
      this.received.push(message);
      this.waiters = this.waiters.filter(waiter => {
        if (!waiter.predicate(message)) return true;
        waiter.resolve(message);
        return false;
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.client.subscribe(`/devices/${this.credentials.deviceId}/#`, error => (error ? reject(error) : resolve()));
    });

    return this;
  }

  public publish(subtopic: string, payload: unknown): Promise<void> {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      this.client.publish(`/devices/${this.credentials.deviceId}/${subtopic}`, body, error => (error ? reject(error) : resolve()));
    });
  }

  /** Reports a sample, which is also what marks the device online. */
  public reportStatus(sensors: Record<string, number> = { temperature: 21 }, outputs: Record<string, number> = {}): Promise<void> {
    return this.publish('status', { sensors, outputs });
  }

  /** Resolves with the first message on `subtopic` that arrives after the call. */
  public async waitFor(subtopic: string, timeoutMs = 10_000, match?: (payload: string) => boolean): Promise<ObservedMessage> {
    const topic = `/devices/${this.credentials.deviceId}/${subtopic}`;
    const predicate = (message: ObservedMessage) => message.topic === topic && (!match || match(message.payload));

    const existing = this.received.find(predicate);
    if (existing) return existing;

    return new Promise<ObservedMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${topic}`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: message => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  public messagesOn(subtopic: string): ObservedMessage[] {
    return this.received.filter(message => message.topic === `/devices/${this.credentials.deviceId}/${subtopic}`);
  }

  public clear(): void {
    this.received.length = 0;
  }

  public async close(): Promise<void> {
    await new Promise<void>(resolve => this.client.end(true, {}, () => resolve()));
  }
}

export const startSimulator = (credentials: DeviceCredentials): Promise<DeviceSimulator> => new DeviceSimulator(credentials).connect();

/**
 * The server only acts on a device it can find, and only after its MQTT
 * subscription is live; a short settle keeps the first publish from racing it.
 */
export const settle = (ms = 300): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
