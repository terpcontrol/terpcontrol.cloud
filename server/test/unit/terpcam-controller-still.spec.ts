import { TerpCamP2PService } from '@modules/camera/terpcam-p2p.service';

/**
 * The controller streams a still back as numbered MQTT fragments. Device
 * messages are handled concurrently, so the fragments can be processed in any
 * order - the final one included.
 */

const DEVICE = 'terpcam-device';
const FRAGMENTS = ['first|', 'second|', 'third'].map(text => Buffer.from(text));

function fragment(seq: number): string {
  const last = seq === FRAGMENTS.length - 1;
  return JSON.stringify({ capture: 7, seq, payload: FRAGMENTS[seq].toString('base64'), ...(last ? { last: true } : {}) });
}

let service: TerpCamP2PService;

beforeEach(() => {
  service = new TerpCamP2PService({ publish: () => true } as never, {} as never);
});

it('assembles a still whose fragments arrive in order', async () => {
  const still = service.captureViaController(DEVICE);
  [0, 1, 2].forEach(seq => service.onImageMessage(DEVICE, fragment(seq)));

  await expect(still).resolves.toEqual(Buffer.concat(FRAGMENTS));
});

it('waits for every fragment when the final one is handled before the others', async () => {
  const still = service.captureViaController(DEVICE);
  [2, 1, 0].forEach(seq => service.onImageMessage(DEVICE, fragment(seq)));

  await expect(still).resolves.toEqual(Buffer.concat(FRAGMENTS));
});
