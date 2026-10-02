import { createAccount } from '../support/api';
import { DeviceSimulator, provisionDevice, settle, startSimulator } from '../support/device';

/**
 * A Terp Cam is read through its controller's relay, so the server asks the
 * controller for one on every try. An offline controller cannot answer, and
 * every try would only wait out the dial-in - three of them, 45 seconds each.
 */

let offline: DeviceSimulator;
let online: DeviceSimulator;

const isRelayRequest = (payload: string) => payload.includes('"cam_relay"');

const withTerpCam = async (did: string): Promise<DeviceSimulator> => {
  const owner = await createAccount('terpcam-offline-owner');
  const simulator = await startSimulator(await provisionDevice(owner, 'controller'));
  await settle();
  // Pairing a camera is what points the device's stream at it.
  await simulator.publish('log', { message: `hardware-info:webcam_did=${did}`, severity: 0, time: Date.now() });
  return simulator;
};

beforeAll(async () => {
  offline = await withTerpCam('AAC0000001TESTA');
  online = await withTerpCam('AAC0000002TESTB');
  await online.reportStatus();
});

afterAll(async () => {
  await offline?.close();
  await online?.close();
});

it('is not read while its controller is offline', async () => {
  // The online one being asked shows a pass of the poller has run - the first
  // comes 30 seconds after the server starts - and the next one is a few seconds
  // behind it.
  await online.waitFor('command', 45_000, isRelayRequest);
  await settle(10_000);
  expect(offline.messagesOn('command').filter(message => isRelayRequest(message.payload))).toHaveLength(0);
}, 60_000);

it('is read as soon as the controller reports', async () => {
  await offline.reportStatus();
  await expect(offline.waitFor('command', 30_000, isRelayRequest)).resolves.toBeDefined();
}, 40_000);
