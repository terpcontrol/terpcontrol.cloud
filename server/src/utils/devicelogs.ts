import type { CloudSettings } from '@fg2/shared-types';

const CAM_CAPTURE_MESSAGE_PREFIX = 'message-cam-capture:';

/**
 * A paired camera reports the outcome of every capture, which is one message
 * every 30 seconds. Those lines are diagnostics rather than diary material: a
 * successful capture never reaches the log, and a failed one only when the
 * owner asked for webcam errors to be logged - the same switch the cloud's own
 * stream errors follow. Firmware in the field still sends the successful ones,
 * so the decision is made here rather than only on the device.
 */
export const isSuppressedCamCaptureLog = (message: string, cloudSettings?: CloudSettings): boolean =>
  message.startsWith(CAM_CAPTURE_MESSAGE_PREFIX) && (message.startsWith(`${CAM_CAPTURE_MESSAGE_PREFIX}ok`) || !cloudSettings?.logRtspStreamErrors);
