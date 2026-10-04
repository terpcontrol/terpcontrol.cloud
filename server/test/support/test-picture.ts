import { Session } from './api';
import { settle } from './device';

/**
 * The test button, pressed the way the camera page presses it: the capture is
 * started, which is answered at once, and then asked after until it is over.
 * Answers the finished capture.
 */
export const takeTestPicture = async (session: Session, cameraId: string, timeoutMs = 20_000): Promise<Record<string, unknown>> => {
  const until = Date.now() + timeoutMs;
  let capture = (await session.client.post(`/v1/cameras/${cameraId}/test-captures`).expect(202)).body;
  while (capture.state === 'running') {
    if (Date.now() > until) throw new Error(`The test picture ${capture.id} was still running after ${timeoutMs} ms.`);
    await settle(100);
    capture = (await session.client.get(`/v1/cameras/${cameraId}/test-captures/${capture.id}`).expect(200)).body;
  }
  return capture;
};
