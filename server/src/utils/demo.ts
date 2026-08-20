import { Alarm, CloudSettings, Device, Recipe } from '@fg2/shared-types';

// Demo sessions are not tied to an account; this stands in for the user id so
// owner-scoped queries (shares, chart presets, recipe templates) match nothing.
export const DEMO_USER_ID = 'demo';

export const DEMO_WRITE_MESSAGE = 'Saving is not supported in demo mode';

// Reported by the device and not for the public: the camera URL carries its
// credentials, the socket list the addresses of someone's local network.
const SECRET_HARDWARE_INFO_KEYS = ['webcam_url', 'socket_ips'];

// The stream URL contains credentials, so demo visitors only learn that a
// webcam exists - the same reduction share links use. A readable example URL
// stands in for it, because the settings form shows this value verbatim.
export const DEMO_WEBCAM_URL = 'rtsp://demo.terpcontrol.cloud:554/growcam';

export const demoCloudSettings = (cloudSettings: CloudSettings): CloudSettings => ({
  ...cloudSettings,
  rtspStream: cloudSettings.rtspStream ? DEMO_WEBCAM_URL : undefined,
});

export const demoHardwareInfo = (hardwareInfo?: Record<string, string>): Record<string, string> | undefined => {
  if (!hardwareInfo) return hardwareInfo;

  return Object.fromEntries(Object.entries(hardwareInfo).filter(([key]) => !SECRET_HARDWARE_INFO_KEYS.includes(key)));
};

// Where an alarm reports to is the owner's contact detail, not part of the demo.
export const demoAlarms = (alarms: Alarm[]): Alarm[] =>
  alarms.map(alarm => {
    const { webhookHeaders, webhookTriggeredPayload, webhookResolvedPayload, ...rest } = alarm;
    return { ...rest, actionTarget: '' };
  });

export const demoRecipe = <T extends Partial<Recipe>>(recipe: T): T => {
  const { email, ...rest } = recipe;
  return rest as T;
};

// Failures are logged with what the device was configured with: a webcam error
// repeats the stream URL (credentials included), a webhook error its endpoint.
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export const demoLogs = <T extends { title?: string; message?: string }>(logs: T[]): T[] =>
  logs.map(log => ({
    ...log,
    title: log.title?.replace(URL_PATTERN, '[hidden]'),
    message: log.message?.replace(URL_PATTERN, '[hidden]'),
  }));

export const demoDevice = <T extends Partial<Device>>(device: T): T => ({
  ...device,
  ...(device.cloudSettings ? { cloudSettings: demoCloudSettings(device.cloudSettings) } : {}),
  ...(device.hardwareInfo ? { hardwareInfo: demoHardwareInfo(device.hardwareInfo) } : {}),
  ...(device.alarms ? { alarms: demoAlarms(device.alarms) as Device['alarms'] } : {}),
  ...(device.recipe ? { recipe: demoRecipe(device.recipe) } : {}),
});
