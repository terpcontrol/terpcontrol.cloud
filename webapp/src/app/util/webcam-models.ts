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
  /** Builds the RTSP URL from credential fields (brand templates only). */
  buildUrl?: (fields: WebcamCredentialFields) => string;
  /** Brand cameras usually sit on the LAN, reachable via the device tunnel. */
  defaultTunnel?: boolean;
}

const rtspUrl = (fields: WebcamCredentialFields, path: string): string => {
  const auth = fields.user ? `${encodeURIComponent(fields.user)}:${encodeURIComponent(fields.password)}@` : '';
  return `rtsp://${auth}${fields.host.trim()}:554/${path}`;
};

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
    buildUrl: fields => rtspUrl(fields, 'stream1'),
    defaultTunnel: true,
  },
  {
    id: 'reolink',
    icon: 'videocam-outline',
    nameKey: 'auxDevices.webcam.models.reolink.name',
    subtitleKey: 'auxDevices.webcam.models.reolink.subtitle',
    buildUrl: fields => rtspUrl(fields, 'h264Preview_01_main'),
    defaultTunnel: true,
  },
  {
    id: 'hikvision',
    icon: 'videocam-outline',
    nameKey: 'auxDevices.webcam.models.hikvision.name',
    subtitleKey: 'auxDevices.webcam.models.hikvision.subtitle',
    buildUrl: fields => rtspUrl(fields, 'Streaming/Channels/101'),
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

/**
 * Extracts user/password/host from an rtsp:// URL so a brand template form can
 * be re-populated from the stored stream URL (nothing else is persisted).
 * Returns null for anything unparseable — including the share-link redaction
 * placeholder '1'.
 */
export function parseRtspUrl(url: string | undefined): WebcamCredentialFields | null {
  if (!url || !url.startsWith('rtsp://')) {
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
