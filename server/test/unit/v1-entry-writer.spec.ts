import { EntryWriterService, UNDO_WINDOW_SECONDS } from '@common/v1/entry-writer.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * A diary line comes from four places and they all have to produce the same
 * document, so the writer is what the timeline is read off. What a device sends
 * is the half nobody else can restate: the firmware's `message-key:param` line,
 * the keys it uses and the report that rides the same topic and is not a diary
 * line at all.
 */

const DEVICE = 'device-1';
const SPACE = 'space-1';
const GROW = 'grow-1';
const CAMERA = 'camera-1';

let db: V1TestDatabase;
let writer: EntryWriterService;

const deviceLine = (line: string, severity = 0) =>
  writer.writeDeviceLine({ deviceId: DEVICE, spaceId: SPACE, growId: GROW, cameraId: CAMERA, line, severity });

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  writer = new EntryWriterService(db.entries);
});

describe('what a device writes', () => {
  it('parses a key with a parameter', async () => {
    const entry = await deviceLine('message-device-booted:POWERON');

    expect(entry?.message).toEqual({ key: 'message-device-booted', params: ['POWERON'] });
    expect(entry?.text).toBeNull();
  });

  it('parses a key that carries no parameter', async () => {
    const entry = await deviceLine('message-co2-low');

    expect(entry?.message).toEqual({ key: 'message-co2-low', params: [] });
  });

  it('keeps everything after the first colon as the one parameter', async () => {
    // The catalogue a client translates against takes one value per key, and a
    // migrated entry reads the same line the same way.
    const entry = await deviceLine('message-smart-socket-cmd-failed:heater:off');

    expect(entry?.message).toEqual({ key: 'message-smart-socket-cmd-failed', params: ['heater:off'] });
  });

  it('keeps a line nobody has a key for as what it says', async () => {
    const entry = await deviceLine('Recipe step 3 finished');

    expect(entry?.message).toBeNull();
    expect(entry?.text).toBe('Recipe step 3 finished');
  });

  it('writes no diary line for a hardware report', async () => {
    expect(await deviceLine('hardware-info:webcam_did=none')).toBeNull();
    expect(await db.entries.countDocuments()).toBe(0);
  });

  it('attaches a line about the camera to the camera, and a line about the device to nothing', async () => {
    const capture = await deviceLine('message-cam-capture:incomplete res=1 bytes=0');
    const boot = await deviceLine('message-device-booted:SW');

    expect(capture?.cameraId).toBe(CAMERA);
    expect(boot?.cameraId).toBeNull();
  });

  it.each([
    [0, 'info'],
    [1, 'warning'],
    [2, 'critical'],
    [9, 'critical'],
  ])('reads severity %i as %s', async (sent, expected) => {
    const entry = await deviceLine('message-buffer-overflow', sent);

    expect(entry?.severity).toBe(expected);
  });

  it('writes a system entry with the device it came from and nothing to undo', async () => {
    const entry = await deviceLine('message-device-firmware-update');

    expect(entry).toMatchObject({
      kind: 'system',
      source: 'device',
      authorId: null,
      deviceId: DEVICE,
      spaceId: SPACE,
      growId: GROW,
      values: { kind: 'system' },
      undoUntil: null,
    });
  });

  it('stores what it returns', async () => {
    const entry = await deviceLine('message-device-booted:PANIC');
    const stored = await db.entries.findOne({ id: entry?.id }).lean();

    expect(stored?.message).toEqual({ key: 'message-device-booted', params: ['PANIC'] });
    expect(stored?.plantIds).toEqual([]);
    expect(stored?.mediaIds).toEqual([]);
  });
});

describe('what the four writers have in common', () => {
  it('takes the kind from the values, so the two cannot disagree', async () => {
    const entry = await writer.write({
      source: 'plan',
      authorId: null,
      growId: GROW,
      values: { kind: 'plan', planId: 'plan-1', stepIndex: 2, transition: 'skip' },
    });

    expect(entry.kind).toBe('plan');
  });

  it('gives a person their entry back for a while', async () => {
    const entry = await writer.write({
      source: 'human',
      authorId: 'user-1',
      growId: GROW,
      values: { kind: 'note' },
      text: 'Topped the two in front.',
    });

    expect(entry.undoUntil?.getTime()).toBe(entry.createdAt.getTime() + UNDO_WINDOW_SECONDS * 1000);
  });

  it('gives nobody an undo for what a machine wrote', async () => {
    const entry = await writer.write({
      source: 'alarm',
      authorId: null,
      deviceId: DEVICE,
      alertId: 'alert-1',
      severity: 'critical',
      values: { kind: 'alarm' },
    });

    expect(entry.undoUntil).toBeNull();
  });

  it('records when it happened rather than when it was written down', async () => {
    const occurredAt = new Date('2026-04-01T08:00:00.000Z');
    const entry = await writer.write({ source: 'human', authorId: 'user-1', occurredAt, values: { kind: 'water', readings: [] } });

    expect(entry.occurredAt).toEqual(occurredAt);
    expect(entry.createdAt.getTime()).toBeGreaterThan(occurredAt.getTime());
  });
});
