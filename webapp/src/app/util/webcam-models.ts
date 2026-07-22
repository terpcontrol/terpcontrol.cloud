import { WebcamModel } from '@fg2/shared-types';

export interface WebcamCredentialFields {
  user: string;
  password: string;
  host: string;
}

export interface WebcamModelTemplate {
  id: WebcamModel;
  nameKey: string;
  subtitleKey: string;
  icon: string;
  /** Terp Control hardware connects through the controller itself. */
  ownDevice?: boolean;
  /**
   * Brand templates only pre-populate the stream URL with placeholder tokens
   * the user replaces inline (<user>, <password>, <ip>).
   */
  placeholderUrl?: string;
  /** Brand cameras usually sit on the LAN, reachable via the device tunnel. */
  defaultTunnel?: boolean;
}

export const WEBCAM_MODELS: WebcamModelTemplate[] = [
  {
    id: 'terp_cam',
    icon: 'videocam',
    nameKey: 'auxDevices.webcam.models.terp_cam.name',
    subtitleKey: 'auxDevices.webcam.models.terp_cam.subtitle',
    ownDevice: true,
    defaultTunnel: true,
  },
  {
    id: 'tapo_c200',
    icon: 'videocam-outline',
    nameKey: 'auxDevices.webcam.models.tapo_c200.name',
    subtitleKey: 'auxDevices.webcam.models.tapo_c200.subtitle',
    placeholderUrl: 'rtsp://<user>:<password>@<ip>:554/stream1',
    defaultTunnel: true,
  },
  {
    id: 'reolink',
    icon: 'videocam-outline',
    nameKey: 'auxDevices.webcam.models.reolink.name',
    subtitleKey: 'auxDevices.webcam.models.reolink.subtitle',
    placeholderUrl: 'rtsp://<user>:<password>@<ip>:554/h264Preview_01_main',
    defaultTunnel: true,
  },
  {
    id: 'hikvision',
    icon: 'videocam-outline',
    nameKey: 'auxDevices.webcam.models.hikvision.name',
    subtitleKey: 'auxDevices.webcam.models.hikvision.subtitle',
    placeholderUrl: 'rtsp://<user>:<password>@<ip>:554/Streaming/Channels/101',
    defaultTunnel: true,
  },
  {
    id: 'custom',
    icon: 'code-working-outline',
    nameKey: 'auxDevices.webcam.models.custom.name',
    subtitleKey: 'auxDevices.webcam.models.custom.subtitle',
  },
];

export function getWebcamModel(id: WebcamModel | undefined): WebcamModelTemplate | undefined {
  return WEBCAM_MODELS.find(model => model.id === id);
}

/** True while the URL still contains unreplaced template tokens. */
export function hasPlaceholders(url: string | undefined): boolean {
  return !!url && /<[a-z-]+>/i.test(url);
}

/**
 * Extracts user/password/host from an rtsp:// URL so the Terp Control Cam
 * fields can be edited (nothing besides the URL is persisted). Returns null
 * for anything unparseable — including placeholder tokens and the share-link
 * redaction value '1'.
 */
export function parseRtspUrl(url: string | undefined): WebcamCredentialFields | null {
  if (!url || !url.startsWith('rtsp://') || hasPlaceholders(url)) {
    return null;
  }
  const match = url.match(/^rtsp:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/@]+)(?::\d+)?(?:\/|$)/);
  if (!match || !match[3]) {
    return null;
  }
  const decode = (value: string | undefined): string => {
    try {
      return decodeURIComponent(value ?? '');
    } catch {
      return value ?? '';
    }
  };
  return { user: decode(match[1]), password: decode(match[2]), host: match[3] };
}

/**
 * Replaces the auth+host part of an rtsp:// URL while keeping port and path —
 * used to edit the Terp Control Cam connection without losing its stream path.
 */
export function replaceRtspAuthHost(url: string, fields: WebcamCredentialFields): string {
  const tail = url.replace(/^rtsp:\/\/(?:[^@/]*@)?[^:/@]+/, '');
  const auth = fields.user ? `${encodeURIComponent(fields.user)}:${encodeURIComponent(fields.password)}@` : '';
  return `rtsp://${auth}${fields.host.trim()}${tail}`;
}
