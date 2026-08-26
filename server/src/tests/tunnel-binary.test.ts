jest.mock('uuid', () => ({ v4: () => 'test-connection-id' }));

const published: { topic: string; message: string }[] = [];
jest.mock('@/databases/mqttclient', () => ({
  mqttclient: { publish: (topic: string, message: string) => published.push({ topic, message }) },
}));

import { connect } from 'node:net';
import { tunnelService } from '@services/tunnel.service';

const DEVICE_ID = 'device-1';

describe('tunnel proxy server', () => {
  beforeEach(() => {
    published.length = 0;
  });

  it('relays bytes above 0x7f unchanged', async () => {
    const proxyUrl = await tunnelService.createTunnelProxyServer(new URL('rtsp://192.168.11.198:554/streamtype=1'), DEVICE_ID);
    // An interleaved RTCP receiver report, as ffmpeg sends it on an RTSP/TCP session.
    const payload = Buffer.from([0x24, 0x01, 0x00, 0x0c, 0x80, 0xc9, 0xff, 0x00]);

    const { port } = new URL(proxyUrl);
    const client = connect(Number(port), '127.0.0.1');
    await new Promise<void>(resolve => client.on('connect', () => resolve()));
    client.write(new Uint8Array(payload));

    await new Promise<void>(resolve => setTimeout(resolve, 200));
    client.destroy();

    const relayed = Buffer.concat(
      published
        .filter(p => p.topic === `/devices/${DEVICE_ID}/tunnel_write`)
        .map(p => JSON.parse(p.message).payload)
        .filter(Boolean)
        .map(p => new Uint8Array(Buffer.from(p, 'base64'))),
    );
    expect(relayed.toString('hex')).toBe(payload.toString('hex'));
  });
});
