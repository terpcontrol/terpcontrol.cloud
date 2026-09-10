import { isSuppressedCamCaptureLog } from '@utils/devicelogs';

const OK = 'message-cam-capture:ok res=2 bytes=31813 got=35/44 soi=0 eoi=33 frags=44 msgs=44 try=1';
const FAILED = 'message-cam-capture:incomplete res=2 bytes=7160 got=8/40 soi=0 eoi=-1 frags=12 msgs=12 try=2';

describe('Camera capture diagnostics in the device log', () => {
  it('never logs a successful capture', () => {
    expect(isSuppressedCamCaptureLog(OK, { logRtspStreamErrors: true })).toBe(true);
    expect(isSuppressedCamCaptureLog(OK, { logRtspStreamErrors: false })).toBe(true);
  });

  it('logs a failed capture unless webcam errors were switched off', () => {
    expect(isSuppressedCamCaptureLog(FAILED, { logRtspStreamErrors: true })).toBe(false);
    expect(isSuppressedCamCaptureLog(FAILED, { logRtspStreamErrors: false })).toBe(true);
  });

  it('treats a device that never configured its webcam like the default the settings read with', () => {
    expect(isSuppressedCamCaptureLog(FAILED, {})).toBe(false);
    expect(isSuppressedCamCaptureLog(FAILED, undefined)).toBe(false);
  });

  it('leaves every other device message alone', () => {
    expect(isSuppressedCamCaptureLog('message-co2-low:380', { logRtspStreamErrors: false })).toBe(false);
    expect(isSuppressedCamCaptureLog('message-cam-reset:ok', { logRtspStreamErrors: false })).toBe(false);
  });
});
