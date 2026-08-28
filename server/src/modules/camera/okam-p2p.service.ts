import { Injectable } from '@nestjs/common';
import { logger } from '@utils/logger';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { OkamCamService } from './okam-cam.service';

/**
 * O-KAM / VStarcam camera stills.
 *
 * The camera has no LAN RTSP and speaks a proprietary P2P protocol whose
 * sliding-window retransmission needs low, predictable latency. Driving that
 * protocol from the cloud through the controller's MQTT tunnel proved
 * unreliable — see docs §16/§16.1 — so the P2P client runs on the controller,
 * which sits on the camera's LAN (firmware/src/okamcam.cpp).
 *
 * This service is the cloud half: it asks a controller for a still and
 * reassembles the JPEG the controller streams back over MQTT. The controller
 * never buffers the whole image (its RAM is scarce), so fragments arrive as it
 * reads them off the wire, tagged with a capture id and a sequence number.
 */

/**
 * cloudSettings.rtspStream marker for an O-KAM camera (`okam://<did>`). Using the
 * existing rtspStream field means the whole image pipeline — poll scheduling,
 * backoff, maintenance gating, the test-image button, storage, timelapses and
 * thinning — works for these cameras with no parallel machinery.
 */
export const OKAM_STREAM_PREFIX = 'okam://';

/** A controller has this long to deliver a complete image once asked. */
const CAPTURE_TIMEOUT_MS = 30_000;
/** Guard against a malfunctioning device streaming without end. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type ImageMessage = {
  capture: number;
  seq?: number;
  last?: boolean;
  abort?: boolean;
  /** payload is a raw H.264 keyframe rather than a JPEG (full-resolution path). */
  h264?: boolean;
  payload?: string;
};

type PendingCapture = {
  capture: number | null;
  chunks: Map<number, Buffer>;
  bytes: number;
  h264: boolean;
  resolve: (jpeg: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

@Injectable()
export class OkamP2PService {
  constructor(private readonly mqtt: MqttClientService, private readonly stills: OkamCamService) {}

  /** One in-flight capture per device; the pipeline never runs two at once. */
  private pending = new Map<string, PendingCapture>();

  /**
   * Ask the device for a still and resolve with the assembled JPEG. Called by
   * the image pipeline (readRtspStreamImage) for devices configured as
   * `okam://…`, which then stores it exactly like an RTSP still.
   */
  public captureViaController(deviceId: string): Promise<Buffer> {
    // An earlier attempt that never completed must not keep its slot (or leak).
    this.failPending(deviceId, new Error('superseded by a new capture'));

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(deviceId, new Error('timed out waiting for the device to deliver an image'));
      }, CAPTURE_TIMEOUT_MS);
      timer.unref?.(); // never hold the event loop open for a still

      this.pending.set(deviceId, { capture: null, chunks: new Map(), bytes: 0, h264: false, resolve, reject, timer });

      this.mqtt.publish('/devices/' + deviceId + '/command', JSON.stringify({ action: 'cam_capture' }));
    });
  }

  /** Handle one `/devices/<id>/image` message from a controller. */
  public onImageMessage(deviceId: string, raw: string): void {
    const state = this.pending.get(deviceId);
    if (!state) {
      return; // nothing waiting — late fragments from an abandoned capture
    }

    let msg: ImageMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Fragments carry the capture they belong to, so a straggler from a previous
    // attempt can never corrupt the current image.
    if (state.capture === null) {
      state.capture = msg.capture;
    } else if (msg.capture !== state.capture) {
      return;
    }

    if (msg.abort) {
      this.failPending(deviceId, new Error('device aborted the capture'));
      return;
    }
    if (!msg.payload) {
      return;
    }

    if (msg.h264) state.h264 = true;
    const chunk = Buffer.from(msg.payload, 'base64');
    state.bytes += chunk.length;
    if (state.bytes > MAX_IMAGE_BYTES) {
      this.failPending(deviceId, new Error('image exceeded the size limit'));
      return;
    }
    state.chunks.set(msg.seq ?? state.chunks.size, chunk);

    if (msg.last) {
      const assembled = Buffer.concat([...state.chunks.keys()].sort((a, b) => a - b).map(k => state.chunks.get(k)));
      const wasH264 = state.h264;
      this.clearPending(deviceId);
      logger.info('[okam] image assembled for ' + deviceId + ': ' + assembled.length + 'B' + (wasH264 ? ' (h264)' : ''));
      if (!wasH264) {
        state.resolve(assembled);
        return;
      }
      // Full-resolution path: the controller sends the raw keyframe (it has no
      // decoder and little RAM); turn it into a JPEG here.
      this.stills
        .decodeKeyframeToJpeg(assembled)
        .then(jpeg => {
          logger.info('[okam] keyframe decoded for ' + deviceId + ': ' + jpeg.length + 'B jpeg');
          state.resolve(jpeg);
        })
        .catch(e => state.reject(e as Error));
    }
  }

  private failPending(deviceId: string, error: Error): void {
    const state = this.pending.get(deviceId);
    if (!state) return;
    this.clearPending(deviceId);
    state.reject(error);
  }

  private clearPending(deviceId: string): void {
    const state = this.pending.get(deviceId);
    if (!state) return;
    clearTimeout(state.timer);
    state.chunks.clear(); // release the fragments promptly
    this.pending.delete(deviceId);
  }
}
