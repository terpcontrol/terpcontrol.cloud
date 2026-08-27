import { anonymous, context, unique } from '../support/api';
import { DeviceCredentials, registerDevice } from '../support/device';

/**
 * The RabbitMQ HTTP auth backend. RabbitMQ posts form-encoded fields and reads
 * the literal body `allow` or `deny`, so both are part of the contract.
 */
const backend = (path: string) => anonymous().post(`/mqttauth/${context.mqttAuthSecret}/${path}`);

let device: DeviceCredentials;

beforeAll(async () => {
  device = await registerDevice();
});

describe('the shared secret in the path', () => {
  it('denies a wrong secret', async () => {
    const response = await anonymous().post('/mqttauth/wrong-secret/user').send({ username: device.username, password: device.password });
    expect(response.status).toBe(401);
    expect(response.text).toBe('deny');
  });

  it('denies a secret that only shares a prefix', async () => {
    const response = await anonymous()
      .post(`/mqttauth/${context.mqttAuthSecret.slice(0, -1)}/user`)
      .send({ username: device.username, password: device.password });
    expect(response.status).toBe(401);
  });
});

describe('POST /mqttauth/:secret/user', () => {
  it('allows a device with its own credentials', async () => {
    const response = await backend('user').send({ username: device.username, password: device.password, vhost: '/', client_id: 'c1' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('allow');
  });

  it('denies a wrong password', async () => {
    const response = await backend('user').send({ username: device.username, password: 'wrong', vhost: '/', client_id: 'c1' });
    expect(response.text).toBe('deny');
  });

  it('denies an unknown username', async () => {
    const response = await backend('user').send({ username: unique('ghost'), password: 'whatever', vhost: '/', client_id: 'c1' });
    expect(response.text).toBe('deny');
  });

  it('denies an empty password against a stored hash', async () => {
    const response = await backend('user').send({ username: device.username, password: '', vhost: '/', client_id: 'c1' });
    expect(response.text).toBe('deny');
  });
});

describe('POST /mqttauth/:secret/vhost', () => {
  it('allows the default vhost', async () => {
    const response = await backend('vhost').send({ username: device.username, vhost: '/', ip: '10.0.0.1', client_id: 'c1' });
    expect(response.text).toBe('allow');
  });

  it('denies any other vhost', async () => {
    const response = await backend('vhost').send({ username: device.username, vhost: '/other', ip: '10.0.0.1', client_id: 'c1' });
    expect(response.text).toBe('deny');
  });

  it('denies an unknown device', async () => {
    const response = await backend('vhost').send({ username: unique('ghost'), vhost: '/', ip: '10.0.0.1', client_id: 'c1' });
    expect(response.text).toBe('deny');
  });
});

describe('POST /mqttauth/:secret/topic', () => {
  const topicRequest = (overrides: Record<string, unknown> = {}) =>
    backend('topic').send({
      username: device.username,
      resource: 'topic',
      name: 'amq.topic',
      permission: 'write',
      tags: '',
      routing_key: `.devices.${device.deviceId}.status`,
      'variable_map.client_id': 'c1',
      ...overrides,
    });

  it('allows a device to use its own topic tree', async () => {
    const response = await topicRequest();
    expect(response.text).toBe('allow');
  });

  it('refuses another device´s topic tree', async () => {
    const response = await topicRequest({ routing_key: '.devices.somebody-else.status' });
    expect(response.status).toBe(403);
  });

  it('refuses a routing key that only prefixes the device id', async () => {
    const response = await topicRequest({ routing_key: `.devices.${device.deviceId}-extra.status` });
    expect(response.status).toBe(403);
  });

  it('denies a resource other than topic', async () => {
    const response = await topicRequest({ resource: 'queue' });
    expect(response.text).toBe('deny');
  });

  it('denies an exchange other than amq.topic', async () => {
    const response = await topicRequest({ name: 'other.exchange' });
    expect(response.text).toBe('deny');
  });
});

describe('POST /mqttauth/:secret/resource', () => {
  const resourceRequest = (overrides: Record<string, unknown> = {}) =>
    backend('resource').send({
      username: device.username,
      vhost: '/',
      resource: 'exchange',
      permission: 'write',
      tags: '',
      client_id: 'c1',
      name: 'amq.topic',
      ...overrides,
    });

  it('allows the topic exchange', async () => {
    const response = await resourceRequest();
    expect(response.text).toBe('allow');
  });

  it('allows the client´s own subscription queue', async () => {
    const response = await resourceRequest({ resource: 'queue', name: 'mqtt-subscription-c1qos0' });
    expect(response.text).toBe('allow');
  });

  it('refuses somebody else´s subscription queue', async () => {
    const response = await resourceRequest({ resource: 'queue', name: 'mqtt-subscription-otherqos0' });
    expect(response.status).toBe(409);
  });

  it('refuses another exchange', async () => {
    const response = await resourceRequest({ name: 'amq.direct' });
    expect(response.status).toBe(409);
  });

  it('denies another vhost', async () => {
    const response = await resourceRequest({ vhost: '/other' });
    expect(response.text).toBe('deny');
  });

  it('denies an unknown device', async () => {
    const response = await resourceRequest({ username: unique('ghost') });
    expect(response.text).toBe('deny');
  });
});
