import { AlarmRule, Camera, Device, Entry, Plan, Socket } from '@fg2/shared-types/v1';
// The `hardware-info` report's own vocabulary.
import { socketListChunk } from '@fg2/shared-types/v1-schemas';

/**
 * The public demo shows somebody's real tent to anyone who asks for it, so what
 * a demo session reads is the same resource with everything personal taken out:
 * an address on a local network, a stream URL with its credentials, where an
 * alarm reports to. What the hardware can *do* stays - that is what the demo is
 * showing.
 *
 * The flag itself is not here: `access()` decides who may read a demo object,
 * and `isDemo` is set on the device, its space, its cameras and the grow in that
 * space together, so redaction never has to guess what is part of the tour.
 */

// Demo sessions are not tied to an account; this stands in for the user id so
// owner-scoped queries match nothing.
export const DEMO_USER_ID = 'demo';

export const DEMO_WRITE_MESSAGE = 'Saving is not supported in demo mode';

// Reported by the device and not for the public: the camera URL carries its
// credentials, the socket list the addresses and MACs of someone's local
// network. Which roles have a socket stays - that is what the demo is showing.
const SECRET_HARDWARE_KEYS = ['webcam_url', 'socket_ips'];

const isSecretHardwareKey = (key: string): boolean => SECRET_HARDWARE_KEYS.includes(key) || socketListChunk(key) !== null;

// The stream URL contains credentials, so demo visitors only learn that a camera
// exists - the same reduction a share link makes. A readable example URL stands
// in for it, because the settings form shows this value verbatim.
export const DEMO_WEBCAM_URL = 'rtsp://demo.terpcontrol.cloud:554/growcam';

// Failures are logged with what the device was configured with: a camera error
// repeats the stream URL (credentials included), a webhook error its endpoint.
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

const hidden = (value: string): string => value.replace(URL_PATTERN, '[hidden]');

export const demoHardware = (hardware: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(hardware).filter(([key]) => !isSecretHardwareKey(key)));

export const demoDevice = (device: Device): Device => ({
  ...device,
  state: { ...device.state, hardware: demoHardware(device.state.hardware) },
});

/**
 * A socket keeps its slot, its role and its state, which is what the demo is
 * about; the MAC and the address it is reached at are somebody's local network.
 */
export const demoSockets = (sockets: Socket[]): Socket[] => sockets.map(socket => ({ ...socket, hardwareId: '', address: '' }));

export const demoCamera = (camera: Camera): Camera => ({
  ...camera,
  did: null,
  uid: null,
  ip: null,
  url: camera.url ? DEMO_WEBCAM_URL : null,
  state: { ...camera.state, lastError: camera.state.lastError ? hidden(camera.state.lastError) : null },
});

// Where an alarm reports to is the owner's contact detail, not part of the demo.
export const demoAlarmRule = (rule: AlarmRule): AlarmRule => ({ ...rule, delivery: { ...rule.delivery, custom: null } });

export const demoPlan = (plan: Plan): Plan => ({ ...plan, notify: { ...plan.notify, email: null } });

export const demoEntry = (entry: Entry): Entry => ({
  ...entry,
  text: entry.text ? hidden(entry.text) : null,
  message: entry.message ? { ...entry.message, params: entry.message.params.map(hidden) } : null,
});
