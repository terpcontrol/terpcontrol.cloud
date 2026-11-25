import { jest } from '@jest/globals';
import { CaptureService, terpCamStreamUrl } from '@modules/v1/camera/capture.service';

/**
 * A Terp Cam whose device switched the camera's own RTSP stream on is read off
 * that stream through the device's tunnel, like any camera on the tent's
 * network; one whose device says nothing of the kind keeps the relay.
 */

type Run = { stdout: Buffer; stderr: string; failure?: Error; timedOut?: boolean };
type RunFfmpeg = (url: string, camera: { url: string; transport: string }, probe: string[], timeoutMs: number) => Promise<Run>;

const TERPCAM = {
  id: 'camera-terpcam',
  kind: 'terpcam_controller',
  deviceId: 'device-1',
  did: 'AAC0000001ABCDE',
  ip: '10.0.0.40',
  secret: 'Sx4kq9Pz2mWa',
  url: null,
  transport: null,
  tunnel: false,
};

const devicesReporting = (hardware: Record<string, string>) => ({
  findOne: jest.fn(() => ({ lean: async () => ({ state: { hardware } }) })),
});

const build = (hardware: Record<string, string>) => {
  const tunnel = { createTunnelProxyServer: jest.fn(async () => 'rtsp://admin:Sx4kq9Pz2mWa@127.0.0.1:41234/tcp/av0_0') };
  const relay = { canReach: jest.fn(() => true), captureStill: jest.fn(async () => Buffer.from('relayed')) };
  const service = new CaptureService(tunnel as never, relay as never, devicesReporting(hardware) as never);
  const run = jest.fn<RunFfmpeg>(async () => ({ stdout: Buffer.from('jpeg'), stderr: '' }));
  (service as unknown as { runFfmpegStill: RunFfmpeg }).runFfmpegStill = run;
  return { service, tunnel, relay, run };
};

describe('the stream a Terp Cam serves itself', () => {
  it('is read through its device tunnel at the address the device reported, over TCP', async () => {
    const { service, tunnel, relay, run } = build({ webcam_rtsp: 'on' });

    await expect(service.readStill(TERPCAM as never)).resolves.toEqual(Buffer.from('jpeg'));

    expect(relay.captureStill).not.toHaveBeenCalled();
    const [target, deviceId] = tunnel.createTunnelProxyServer.mock.calls[0] as unknown as [URL, string];
    expect(target.toString()).toBe('rtsp://admin:Sx4kq9Pz2mWa@10.0.0.40:10554/tcp/av0_0');
    expect(deviceId).toBe('device-1');
    expect(run.mock.calls[0][1]).toMatchObject({ transport: 'tcp' });
  });

  it('is not tried before the device has said where the camera answers', async () => {
    const { service, tunnel } = build({ webcam_rtsp: 'on' });

    await expect(service.readStill({ ...TERPCAM, ip: null } as never)).rejects.toThrow('not yet found its camera');
    expect(tunnel.createTunnelProxyServer).not.toHaveBeenCalled();
  });

  it('leaves a camera its device does not stream on the relay', async () => {
    for (const hardware of [{ webcam_rtsp: 'off' }, {}] as Record<string, string>[]) {
      const { service, tunnel, relay } = build(hardware);

      await expect(service.readStill(TERPCAM as never)).resolves.toEqual(Buffer.from('relayed'));
      expect(tunnel.createTunnelProxyServer).not.toHaveBeenCalled();
      expect(relay.captureStill).toHaveBeenCalled();
    }
  });
});

describe('terpCamStreamUrl', () => {
  it('logs in as the admin account with the device password', () => {
    expect(terpCamStreamUrl('192.0.2.7', 'p@ss:w/rd')).toBe('rtsp://admin:p%40ss%3Aw%2Frd@192.0.2.7:10554/tcp/av0_0');
  });

  it('sends no login without a password', () => {
    expect(terpCamStreamUrl('192.0.2.7', null)).toBe('rtsp://192.0.2.7:10554/tcp/av0_0');
  });

  it('takes nothing but an IPv4 address', () => {
    for (const ip of [null, '', 'none', 'evil.test', '192.0.2.7:80/x', '192.0.2.7@evil.test']) {
      expect(terpCamStreamUrl(ip, 'secret')).toBeNull();
    }
  });
});
