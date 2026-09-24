import { jest } from '@jest/globals';
import { Model } from 'mongoose';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { StoredClaimCode, claimCodesSchema } from '@database/schemas/v1/claim-codes.schema';
import { StoredDeviceClass, deviceClassesSchema } from '@database/schemas/v1/device-classes.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { DeviceRegistrationService } from '@modules/device-protocol/device-registration.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { DeviceSample } from '@modules/device-protocol/device-sinks';
import { decodeCapabilities, decodeSockets } from '@modules/device-protocol/sockets';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { hashDevicePassword } from '@utils/devicepassword';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The boundary between a device's vocabulary and the model.
 *
 * Everything asserted here is a translation that only this module makes: epoch
 * seconds into an instant and device field names into metrics, the chunked
 * socket table into rows, a typed command into the words the firmware reads, a
 * reported camera into a camera of its own. None of it has an HTTP surface the
 * black-box suite could drive - a device speaks MQTT - and every one of them is
 * frozen by hardware in the field.
 */

const DEVICE = 'sim-controller-1';
const OWNER = 'user-1';

let db: V1TestDatabase;
let claimCodes: Model<StoredClaimCode>;
let deviceClasses: Model<StoredDeviceClass>;
let published: { topic: string; message: string }[];
let mqtt: MqttClientService;
let ingest: DeviceIngestService;
let publisher: DevicePublisherService;
let registration: DeviceRegistrationService;
let samples: { deviceId: string; sample: DeviceSample }[];
let metrics: { deviceId: string; values: Record<string, number>; outputs: Record<string, number> }[];
let seen: string[];
let firmwareReports: string[];

const device = (fields: Partial<StoredDevice> = {}) => db.devices.create({ id: DEVICE, type: 'controller', ownerId: OWNER, ...fields });

const messageOn = (topic: string, payload: unknown) =>
  ingest.handle(`/devices/${DEVICE}/${topic}`, typeof payload === 'string' ? payload : JSON.stringify(payload));

const stored = () => db.devices.findOne({ id: DEVICE }).lean<StoredDevice>();

beforeAll(async () => {
  db = await startV1TestDatabase();
  claimCodes = db.connection.model<StoredClaimCode>(MODEL_V1.claimCode, claimCodesSchema);
  deviceClasses = db.connection.model<StoredDeviceClass>(MODEL_V1.deviceClass, deviceClassesSchema);
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  published = [];
  samples = [];
  metrics = [];
  seen = [];
  firmwareReports = [];

  mqtt = {
    canPublish: true,
    publish: jest.fn((topic: string, message: string) => {
      published.push({ topic, message });
      return true;
    }),
  } as unknown as MqttClientService;

  publisher = new DevicePublisherService(db.devices, mqtt);
  const hardware = new HardwareReportService(db.devices, db.cameras);
  registration = new DeviceRegistrationService(db.devices, deviceClasses, claimCodes, {
    enableSelfRegistration: true,
    selfRegistrationPassword: 'join-me',
  } as never);

  ingest = new DeviceIngestService(
    db.devices,
    db.cameras,
    mqtt,
    publisher,
    hardware,
    new EntryWriterService(db.entries),
    { writeSample: async (deviceId, sample) => void samples.push({ deviceId, sample }) },
    { onSample: async sample => void metrics.push({ deviceId: sample.deviceId, values: sample.values, outputs: sample.outputs }) },
    null,
    null,
    { onDeviceSeen: deviceId => void seen.push(deviceId), onFirmwareReported: (_, firmwareId) => void firmwareReports.push(firmwareId) },
  );
});

describe('what a device reports', () => {
  it('dates a bulk reading by the device and names its fields by the contract', async () => {
    await device();

    await messageOn('bulk', {
      sensors: { temperature: 24.6, leaf_temperature: 22.1, sensor_type: 2 },
      outputs: { light: 100, 'fan-internal': 40, spindle: 1 },
      timestamp: 1758100000,
    });

    expect(samples[0].sample.measuredAt).toEqual(new Date(1758100000 * 1000));
    // Stored as the device names them, diagnostics included; evaluated under the
    // names the contract gives them, which has no name for `sensor_type`.
    expect(samples[0].sample.sensors).toEqual({ temperature: 24.6, leaf_temperature: 22.1, sensor_type: 2 });
    expect(samples[0].sample.outputs).toEqual({ light: 100, 'fan-internal': 40, spindle: 1 });
    expect(metrics[0].values).toEqual({ temperature: 24.6, leafTemperature: 22.1 });
    // The outputs are named the same way, and an output the API names nothing
    // for is no more evaluated than a diagnostic sensor is.
    expect(metrics[0].outputs).toEqual({ light: 100, fanInternal: 40 });
    expect(seen).toEqual([DEVICE]);
  });

  it('keeps a controller´s "no CO2 sensor fitted" figure out of the store', async () => {
    await device();

    // The protocol says -1 is how a controller with no SCD sensor says there is
    // none, and a plug with no CO2 hardware at all writes a flat zero. Neither
    // is a concentration, so neither is stored or evaluated - while the
    // temperature that came in the same message is both.
    await messageOn('bulk', { sensors: { temperature: 24.6, co2: -1 }, outputs: {}, timestamp: 1758100000 });
    await messageOn('bulk', { sensors: { temperature: 24.7, co2: 0 }, outputs: {}, timestamp: 1758100030 });

    expect(samples[0].sample.sensors).toEqual({ temperature: 24.6 });
    expect(samples[1].sample.sensors).toEqual({ temperature: 24.7 });
    expect(metrics.map(sample => sample.values)).toEqual([{ temperature: 24.6 }, { temperature: 24.7 }]);
  });

  it('keeps a controller´s "no CO2 valve" figure out of the store', async () => {
    await device();

    // The firmware writes -1 into an unsigned field, so absence arrives as
    // 0xFFFFFFFF. The lamp beside it is a real output and stays.
    await messageOn('bulk', { sensors: {}, outputs: { co2: 4294967295, light: 100 }, timestamp: 1758100000 });

    expect(samples[0].sample.outputs).toEqual({ light: 100 });
    expect(metrics[0].outputs).toEqual({ light: 100 });
  });

  it('stores a CO2 valve that really opened', async () => {
    await device();

    // The output is a count of open ticks since the last publish, so zero is a
    // valve that stayed shut and is as much a state as any other.
    await messageOn('bulk', { sensors: {}, outputs: { co2: 0 }, timestamp: 1758100000 });
    await messageOn('bulk', { sensors: {}, outputs: { co2: 240 }, timestamp: 1758100030 });

    expect(samples.map(one => one.sample.outputs)).toEqual([{ co2: 0 }, { co2: 240 }]);
  });

  it('stores the CO2 a fitted sensor really measured', async () => {
    await device();

    await messageOn('bulk', { sensors: { co2: 412 }, outputs: {}, timestamp: 1758100000 });

    expect(samples[0].sample.sensors).toEqual({ co2: 412 });
    expect(metrics[0].values).toEqual({ co2: 412 });
  });

  it('records a reading that arrives on status at server time', async () => {
    await device();
    const before = Date.now();

    // No firmware build sends one; the simulator does, and the timestamp it
    // carries has always been discarded.
    await messageOn('status', { sensors: { temperature: 20 }, outputs: {}, timestamp: 1 });

    expect(samples[0].sample.measuredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('takes a bare value from a device in custom-MQTT mode and drops it', async () => {
    await device();

    await messageOn('status/sensors/temperature', '23.5');

    expect(samples).toEqual([]);
    // It counts as alive all the same: something published, so something is there.
    expect(seen).toEqual([DEVICE]);
    expect((await stored())?.state.lastSeenAt).not.toBeNull();
  });

  it('hears a device nobody owns without recording what it measured', async () => {
    await device({ ownerId: null });

    await messageOn('bulk', { sensors: { temperature: 21 }, outputs: {}, timestamp: 1758100000 });

    expect(samples).toEqual([]);
    expect((await stored())?.state.lastSeenAt).not.toBeNull();
  });

  it('answers a fetch with the configuration it holds, and with nothing when it holds none', async () => {
    await device();
    await messageOn('fetch', { firmware_id: 'build-1' });
    expect(published).toEqual([]);

    await db.devices.updateOne({ id: DEVICE }, { $set: { configuration: { day: { temperature: 27 } } } });
    await messageOn('fetch', { firmware_id: 'build-1' });

    expect(published).toEqual([{ topic: `/devices/${DEVICE}/configuration`, message: '{"day":{"temperature":27}}' }]);
  });

  /**
   * A command is published once and the broker keeps none, so maintenance sent
   * while a device was reconnecting was lost, while every screen went on saying
   * its heater was parked. The fetch that follows a reconnect says it again,
   * for what is left of the window.
   */
  it('tells a reconnecting device what is left of a maintenance window it may have missed', async () => {
    await device({ state: { maintenanceUntil: new Date(Date.now() + 7.5 * 60_000) } as never });

    await messageOn('fetch', { firmware_id: 'build-1' });

    expect(published).toEqual([{ topic: `/devices/${DEVICE}/command`, message: '{"action":"maintenance","durationMinutes":7}' }]);
  });

  it('says nothing of a window that has run out, or has less than a minute left', async () => {
    await device({ state: { maintenanceUntil: new Date(Date.now() + 30_000) } as never });
    await messageOn('fetch', { firmware_id: 'build-1' });

    await db.devices.updateOne({ id: DEVICE }, { $set: { 'state.maintenanceUntil': new Date(Date.now() - 60_000) } });
    await messageOn('fetch', { firmware_id: 'build-1' });

    expect(published).toEqual([]);
  });

  it('records the build a device came back running, after saying so', async () => {
    await device({ state: { firmwareId: 'build-1' } as never });

    await messageOn('fetch', { firmware_id: 'build-2' });

    expect(firmwareReports).toEqual(['build-2']);
    expect((await stored())?.state.firmwareId).toBe('build-2');
  });

  it('overwrites its copy of the configuration when the device reports one', async () => {
    await device({ configuration: { day: { temperature: 25 } } });

    await messageOn('configuration', { day: { temperature: 28 }, workmode: 'breed' });

    expect((await stored())?.configuration).toEqual({ day: { temperature: 28 }, workmode: 'breed' });
  });
});

describe('what a device logs', () => {
  it('writes a line to the timeline with the space the device stands in', async () => {
    await device({ spaceId: 'space-1' });

    await messageOn('log', { severity: 0, message: 'message-device-booted:POWERON' });

    const entry = await db.entries.findOne({ deviceId: DEVICE }).lean();
    expect(entry).toMatchObject({
      kind: 'system',
      source: 'device',
      spaceId: 'space-1',
      message: { key: 'message-device-booted', params: ['POWERON'] },
    });
  });

  it('silences its own alarms for as long as the device says it is being worked on', async () => {
    await device();
    const before = Date.now();

    await messageOn('log', { severity: 0, message: 'message-maintenance-mode-activated-remote:30' });

    const until = (await stored())?.state.maintenanceUntil;
    expect(until?.getTime()).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
  });

  it('keeps a hardware report out of the diary and in the device', async () => {
    await device();

    await messageOn('log', { severity: 0, message: 'hardware-info:co2=on' });

    expect(await db.entries.countDocuments()).toBe(0);
    expect((await stored())?.state.hardware).toEqual({ co2: 'on' });
  });

  it('drops a successful capture, and a failed one until the camera says to keep it', async () => {
    await device();
    await messageOn('log', { severity: 0, message: 'message-cam-capture:ok res=1280x720' });
    await messageOn('log', { severity: 1, message: 'message-cam-capture:incomplete res=1280x720 bytes=0' });
    expect(await db.entries.countDocuments()).toBe(0);

    await db.cameras.create({ id: 'camera-1', ownerId: OWNER, kind: 'terpcam_controller', deviceId: DEVICE, name: 'Cam', logErrors: true });
    await messageOn('log', { severity: 1, message: 'message-cam-capture:incomplete res=1280x720 bytes=0' });

    // A line about the camera is attached to the camera it is about.
    expect(await db.entries.findOne({}).lean()).toMatchObject({ cameraId: 'camera-1', severity: 'warning' });
  });
});

describe('the hardware report', () => {
  const report = (line: string) => messageOn('log', { severity: 0, message: `hardware-info:${line}` });

  it('never stores the camera credentials it is told', async () => {
    await device();

    await report('webcam_did=ABCD1234');
    await report('webcam_pwd=hunter2');
    await report('webcam_url=rtsp://user:pw@192.168.1.9:554/1');

    // They would be handed out with the sockets; the password belongs to the
    // camera, where nothing serialises it, and nothing reads the stored URL.
    expect(Object.keys((await stored())?.state.hardware ?? {})).toEqual(['webcam_did']);
    expect((await db.cameras.findOne({ deviceId: DEVICE }).select('+secret').lean())?.secret).toBe('hunter2');
  });

  it('makes the camera a controller pairs a camera of its own, with its year of Premium', async () => {
    await device({ spaceId: 'space-1', name: 'Tent' });

    await report('webcam_did=ABCD1234');

    const camera = await db.cameras.findOne({ deviceId: DEVICE }).lean();
    expect(camera).toMatchObject({ kind: 'terpcam_controller', did: 'ABCD1234', spaceId: 'space-1', name: 'Tent', ownerId: OWNER });
    expect(camera?.entitlement.grant).toBe('included');
    expect(camera?.entitlement.validUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('names the camera after the controller it hangs on, and after the cam itself where nobody has named that', async () => {
    // A claim stores the device's type where no name was given, and copying
    // that onto the camera would head a camera row with a translation key.
    await device({ spaceId: 'space-1', name: 'controller' });

    await report('webcam_did=TCAM00A41C');

    expect((await db.cameras.findOne({ deviceId: DEVICE }).lean())?.name).toBe('Terp Cam · 00A41C');
  });

  it('retires the camera when the device says it has none, and gives it back its year when it is paired again', async () => {
    await device();
    await report('webcam_did=ABCD1234');
    const granted = (await db.cameras.findOne({ deviceId: DEVICE }).lean())?.entitlement.validUntil;

    await report('webcam_did=none');
    expect((await db.cameras.findOne({ deviceId: DEVICE }).lean())?.removedAt).not.toBeNull();

    await report('webcam_did=ABCD1234');
    const camera = await db.cameras.findOne({ deviceId: DEVICE }).lean();
    expect(camera?.removedAt).toBeNull();
    // The year is not restarted by re-pairing, and the pictures keep their camera.
    expect(camera?.entitlement.validUntil).toEqual(granted);
    expect(await db.cameras.countDocuments()).toBe(1);
  });

  it('keeps no camera for a device nobody owns', async () => {
    await device({ ownerId: null });

    await report('webcam_did=ABCD1234');

    expect(await db.cameras.countDocuments()).toBe(0);
  });

  it('forgets the chunks of a table that has shrunk', async () => {
    await device();
    await report('sockets_n=4');
    await report('socket_list0=heater|AA|10.0.0.1,heater|BB|10.0.0.2,light|CC|10.0.0.3');
    await report('socket_list1=co2|DD|10.0.0.4');

    await report('sockets_n=2');

    const hardware = (await stored())?.state.hardware ?? {};
    expect(hardware.socket_list1).toBeUndefined();
    expect(hardware.socket_list0).toBeDefined();
  });

  it('stamps a socket row that was seen to change state', async () => {
    await device();
    await report('sockets_n=1');
    await report('socket_list0=heater|AA|10.0.0.1|on');
    expect((await stored())?.state.socketStateChangedAt).toEqual({});

    await report('socket_list0=heater|AA|10.0.0.1|off');

    expect((await stored())?.state.socketStateChangedAt['0']).toBeInstanceOf(Date);
    // An override's row carries the seconds it has left and never an instant,
    // so when the table arrived is what those seconds are read against.
    expect((await stored())?.state.socketsReportedAt).toBeInstanceOf(Date);
  });

  it('stamps a socket that stopped answering, so the row can say since when', async () => {
    await device();
    await report('sockets_n=1');
    await report('socket_list0=heater|AA|10.0.0.1|on');

    // A socket that stops answering says nothing rather than repeating what it
    // was last told, and how long it has been quiet is the rest of that fact.
    await report('socket_list0=heater|AA|10.0.0.1||');

    expect((await stored())?.state.socketStateChangedAt['0']).toBeInstanceOf(Date);
  });

  it('stamps nothing when a build starts reporting the state column', async () => {
    await device();
    await report('sockets_n=1');
    await report('socket_list0=heater|AA|10.0.0.1');

    await report('socket_list0=heater|AA|10.0.0.1|on');

    expect((await stored())?.state.socketStateChangedAt).toEqual({});
  });

  it('forgets when a slot changed state once another socket sits in it', async () => {
    await device();
    await report('sockets_n=1');
    await report('socket_list0=heater|AA|10.0.0.1|on');
    await report('socket_list0=heater|AA|10.0.0.1|off');
    expect((await stored())?.state.socketStateChangedAt['0']).toBeInstanceOf(Date);

    // A stamp is keyed by slot, and a slot outlives the socket that sat in it.
    await report('socket_list0=pump|BB|10.0.0.2|on');
    expect((await stored())?.state.socketStateChangedAt).toEqual({});

    await report('sockets_n=0');
    expect((await stored())?.state.socketStateChangedAt).toEqual({});
  });
});

describe('the socket table', () => {
  it('reads a chunked table into the slots a command addresses', async () => {
    const sockets = decodeSockets({
      sockets_n: '4',
      socket_list0: 'heater|4C7525A1B2C3|192.168.1.60,heater|4C7525A1B2C4|192.168.1.62,light|4C7525A1B2C5|192.168.1.61',
      socket_list1: 'co2|4C7525A1B2C6|192.168.1.63|on|override=off@120',
    });

    expect(sockets.map(socket => [socket.slot, socket.role, socket.address])).toEqual([
      [0, 'heater', '192.168.1.60'],
      [1, 'heater', '192.168.1.62'],
      [2, 'light', '192.168.1.61'],
      [3, 'co2', '192.168.1.63'],
    ]);
    expect(sockets[3].override?.state).toBe('off');
    expect(sockets[0].state).toBe('unknown');
  });

  it('answers the older summary with the role as the address', () => {
    const sockets = decodeSockets({ sockets: 'heater,light', socket_ips: 'heater@192.168.1.60,light@192.168.1.61' });

    expect(sockets).toHaveLength(2);
    expect(sockets[0]).toMatchObject({ slot: -1, role: 'heater', address: '192.168.1.60', state: 'unknown' });
  });

  it('offers a build that announces nothing the roles every build knows', () => {
    const capabilities = decodeCapabilities({ sockets: 'none' });

    expect(capabilities).toMatchObject({ socketOverride: false, socketTimer: false, lightOverride: false });
    // The empty role leads every list: it is how a socket is handed back, and no build announces it.
    expect(capabilities.roles).toEqual(['', 'dehumidifier', 'heater', 'light', 'secondary_light', 'co2']);
  });

  it('reads what a build announces', () => {
    const capabilities = decodeCapabilities({ caps: 'socket_override,socket_timer', socket_roles: 'heater,pump', socket_pulse: 'heater:300' });

    expect(capabilities).toMatchObject({ socketOverride: true, socketTimer: true, lightOverride: false, roles: ['', 'heater', 'pump'] });
    expect(capabilities.pulseSeconds).toEqual({ heater: 300 });
  });
});

describe('what the cloud tells a device', () => {
  const sent = () => JSON.parse(published[0].message);

  it('counts a maintenance window in the minutes the device understands', async () => {
    await device();

    await publisher.command(DEVICE, { kind: 'maintenance', forSeconds: 1800 });

    expect(sent()).toEqual({ action: 'maintenance', durationMinutes: 30 });
    // The window is kept here as well, so it survives a device that never heard.
    expect((await stored())?.state.maintenanceUntil).not.toBeNull();
  });

  it('adds a socket to a role when no slot is named, and configures the named one otherwise', async () => {
    await device({ state: { hardware: { sockets_n: '3', socket_list0: 'heater|AA|10.0.0.1,light|BB|10.0.0.2,heater|CC|10.0.0.3' } } as never });

    await publisher.command(DEVICE, { kind: 'socket_set', slot: null, role: 'heater', address: '10.0.0.9', credentials: null, timer: null });
    expect(sent()).toEqual({ action: 'socket_set', role: 'heater', ip: '10.0.0.9', append: true });

    published = [];
    await publisher.command(DEVICE, {
      kind: 'socket_set',
      slot: 2,
      role: 'heater',
      address: '10.0.0.9',
      credentials: { username: 'admin', password: '' },
      timer: null,
    });
    // An empty password puts the socket back on the device's default; leaving
    // the pair out keeps whatever it had.
    expect(sent()).toEqual({ action: 'socket_set', role: 'heater', ip: '10.0.0.9', slot: 2, user: 'admin', password: '' });
  });

  it('refuses a slot the device reports no socket in, rather than sending one it would drop', async () => {
    await device({ state: { hardware: { sockets_n: '1', socket_list0: 'heater|AA|10.0.0.1' } } as never });

    await expect(
      publisher.command(DEVICE, { kind: 'socket_set', slot: 4, role: 'heater', address: '10.0.0.9', credentials: null, timer: null }),
    ).rejects.toThrow(/no socket in slot 4/);
    expect(published).toEqual([]);
  });

  it('sends nothing a device has not announced it understands', async () => {
    await device({ state: { hardware: { socket_roles: 'heater' } } as never });

    await expect(
      publisher.command(DEVICE, { kind: 'socket_set', slot: null, role: 'pump', address: '10.0.0.9', credentials: null, timer: null }),
    ).rejects.toThrow(/has not announced/);
    await expect(
      publisher.command(DEVICE, { kind: 'socket_override', subject: { type: 'socket', id: '0' }, state: 'on', forSeconds: 60 }),
    ).rejects.toThrow(/has not announced/);
    expect(published).toEqual([]);
  });

  it('names a socket by the role the device reports it under', async () => {
    await device({ state: { hardware: { sockets_n: '2', socket_list0: 'heater|AA|10.0.0.1,light|BB|10.0.0.2' } } as never });

    await publisher.socketAction(DEVICE, 'socket_test', 1);

    expect(sent()).toEqual({ action: 'socket_test', role: 'light', slot: 1 });
  });
});

describe('enrolling and claiming', () => {
  const enrol = () =>
    registration.register({
      registration_password: 'join-me',
      device_id: 'sim-fridge-9',
      device_type: 'fridge',
      username: 'mqtt-user',
      password: 'mqtt-password',
    });

  beforeEach(async () => {
    await deviceClasses.create({ id: 'class-1', name: 'fridge', concurrentUpdates: 5, maxFailures: 10, firmwareIds: { stable: 'build-7' } });
  });

  it('answers with the build the class runs and stores what the device signs in with', async () => {
    expect(await enrol()).toEqual({ fw: 'build-7' });

    const enrolled = await db.devices.findOne({ id: 'sim-fridge-9' }).select('+mqtt').lean<StoredDevice>();
    expect(enrolled).toMatchObject({ type: 'fridge', classId: 'class-1', ownerId: null, serialNumber: 1 });
    expect(enrolled?.mqtt?.username).toBe('mqtt-user');
    // The password is never stored as it was sent.
    expect(enrolled?.mqtt?.passwordHash).not.toBe('mqtt-password');
    expect(enrolled?.firmware).toEqual({ channel: 'manual', targetId: 'build-7' });
  });

  it('refuses a device whose type this cloud has no class for', async () => {
    expect(
      await registration.register({
        registration_password: 'join-me',
        device_id: 'sim-dryer-1',
        device_type: 'dryer',
        username: 'u',
        password: 'p',
      }),
    ).toBeNull();
  });

  it('lets a device that enrolled again issue a claim code, whatever it reported before', async () => {
    await enrol();
    await db.devices.updateOne({ id: 'sim-fridge-9' }, { $set: { 'state.hardware.claimcode_auth': 'on' } });

    await enrol();

    const code = await registration.issueClaimCode({ device_id: 'sim-fridge-9' });
    expect(code?.claim_code).toHaveLength(6);
    expect((await claimCodes.findOne({ deviceId: 'sim-fridge-9' }).lean())?.code).toBe(code?.claim_code);
  });

  it('checks the password only where the device asked for it to be checked', async () => {
    await db.devices.create({
      id: DEVICE,
      type: 'controller',
      mqtt: { username: 'u', passwordHash: await hashDevicePassword('secret') },
      state: { hardware: { claimcode_auth: 'on' } },
    });

    expect(await registration.issueClaimCode({ device_id: DEVICE })).toBeNull();
    expect(await registration.issueClaimCode({ device_id: DEVICE, password: 'wrong' })).toBeNull();
    expect(await registration.issueClaimCode({ device_id: DEVICE, password: 'secret' })).not.toBeNull();

    // Firmware that never reported the key predates the check; refusing those
    // would take the claim code off their display for good.
    await db.devices.updateOne({ id: DEVICE }, { $unset: { 'state.hardware.claimcode_auth': '' } });
    expect(await registration.issueClaimCode({ device_id: DEVICE })).not.toBeNull();
  });

  it('gives one device one code', async () => {
    await device();

    const first = await registration.issueClaimCode({ device_id: DEVICE });
    const second = await registration.issueClaimCode({ device_id: DEVICE });

    expect(first?.claim_code).not.toBe(second?.claim_code);
    expect(await claimCodes.countDocuments({ deviceId: DEVICE })).toBe(1);
  });
});
