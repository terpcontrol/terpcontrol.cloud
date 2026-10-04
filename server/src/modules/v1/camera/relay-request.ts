/**
 * Asking a device to open a camera relay. The command, its topic and its payload
 * belong to the device protocol, so the camera pipeline names only what it wants
 * - a relay to `url`, keyed by `token` and enciphered under `key` - and the
 * protocol module (`DevicePublisherService.requestRelay`) does the asking.
 */
export interface RelayRequest {
  url: string;
  token: string;
  /** 32 bytes as hex: the first half enciphers what the device sends, the second what it receives. */
  key: string;
}

export interface RelayRequestPort {
  /** False where the broker connection is down, which is a camera that cannot be reached rather than an error. */
  requestRelay(deviceId: string, relay: RelayRequest): boolean;
}

export const RELAY_REQUEST = 'camera:relay-request';
