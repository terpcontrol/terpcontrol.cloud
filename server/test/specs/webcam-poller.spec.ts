import { createAccount, Session, unique } from '../support/api';
import { provisionDevice, settle } from '../support/device';
import { armFfmpeg, ffmpegCalls, resetFfmpeg } from '../support/ffmpeg';

/**
 * What the poller does while one camera is not answering. ffmpeg is given 90
 * seconds before a run is given up on, and every customer's camera is read by
 * the same poller, so what a pass does with that wait is everybody's still.
 *
 * Neither camera here is ever reached - both are addressed at a closed port.
 * What is asserted is which runs the server started and when, through the
 * ffmpeg shim (see support/ffmpeg.ts).
 */

/** Long enough to still be holding while both facts below are established. */
const HANG_MS = 60_000;
const HANGING_PATH = unique('/hangs');
const RESPONSIVE_PATH = unique('/answers');
const stream = (path: string) => `rtsp://127.0.0.1:1${path}`;

let owner: Session;

const runsOf = (path: string): string[][] => ffmpegCalls().filter(args => args.some(argument => argument.includes(path)));

const pointACameraAt = async (path: string) => {
  const device = await provisionDevice(owner);
  await owner.client
    .post('/device/cloudsettings')
    .send({ device_id: device.deviceId, cloud_settings: { rtspStream: stream(path), firmwareChannel: 'stable' } })
    .expect(200);
};

const waitForARunOf = async (path: string, withinMs: number): Promise<number> => {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && runsOf(path).length === 0) await settle(500);
  return runsOf(path).length;
};

beforeAll(async () => {
  owner = await createAccount('webcam-poller-owner');
  resetFfmpeg();
  armFfmpeg([{ match: HANGING_PATH, delayMs: HANG_MS, stderr: 'harness: the camera never answered', exit: 1 }]);

  await pointACameraAt(HANGING_PATH);
  // The read has to be under way before the second camera is added: started by
  // the same pass, the two would say nothing about waiting for each other.
  if ((await waitForARunOf(HANGING_PATH, 30_000)) === 0) {
    throw new Error('The poller never read the camera these specs are about');
  }

  await pointACameraAt(RESPONSIVE_PATH);
}, 60_000);

afterAll(() => resetFfmpeg());

it('reads the next device while a camera it cannot reach is still being waited on', async () => {
  expect(await waitForARunOf(RESPONSIVE_PATH, 25_000)).toBeGreaterThan(0);

  // And the one being waited on has been visited by that pass without being
  // read again: a device is due every 30 seconds where a read may take 90, so
  // the interval between tries is not what keeps two off the same camera.
  expect(runsOf(HANGING_PATH)).toHaveLength(1);
}, 40_000);

it('leaves it at one read for as long as that read is in flight', async () => {
  await settle(15_000);

  expect(runsOf(HANGING_PATH)).toHaveLength(1);
}, 40_000);
