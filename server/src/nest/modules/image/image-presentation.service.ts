import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Image } from '@fg2/shared-types';
import { ONLINE_TIMEOUT } from '@services/device.service';
import { imageService } from '@services/image.service';
import { logger } from '@utils/logger';

// Requests for the current picture carry no timestamp, or one at "now" as a cache
// buster. Anything older asks for the past and is served without the notice.
const LATEST_IMAGE_TOLERANCE_MS = 60 * 1000;

const MAX_RESIZE_DIMENSION = 4096;

// Drawn into the image, so the time zone is named: the reader cannot tell which
// one the server used otherwise.
const buildOfflineCaption = (timestamp: number): string => {
  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(timestamp);
  return `Offline since ${when}`;
};

export const parseResizeDimension = (value: unknown, max = MAX_RESIZE_DIMENSION): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  const normalized = Math.floor(parsed);
  if (normalized <= 0) return undefined;

  return Math.min(normalized, max);
};

export interface RenderOptions {
  width?: number;
  height?: number;
}

export interface RenderedImage {
  body: Buffer;
  contentType: string;
  /** 500 when resizing failed and the placeholder is being sent instead. */
  status: number;
}

/** Turning a stored picture into what goes over the wire. */
@Injectable()
export class ImagePresentationService {
  /**
   * The image URL is consumed by the webapp and by other services alike, so a
   * still that is too old for the device to count as online carries the notice
   * in the picture instead of leaving it to the client.
   */
  public async withOfflineOverlay(image: Image, requestedTimestamp: number, byImageId: boolean): Promise<Buffer> {
    const wantsLatest = !(requestedTimestamp > 0) || requestedTimestamp >= Date.now() - LATEST_IMAGE_TOLERANCE_MS;

    if (image.format !== 'jpeg' || byImageId || !wantsLatest || Date.now() - image.timestamp <= ONLINE_TIMEOUT) {
      return image.data;
    }

    return imageService.addOfflineOverlay(image.data, buildOfflineCaption(image.timestamp));
  }

  public placeholder(format: string): Promise<RenderedImage> {
    return format === 'mp4'
      ? readFile('assets/no-image_placeholder.mp4').then(body => ({ body, contentType: 'video/mp4', status: 200 }))
      : readFile('assets/no-image_placeholder.png').then(body => ({ body, contentType: 'image/png', status: 200 }));
  }

  /** Resizes when asked to, never enlarging; a failure falls back to the placeholder. */
  public async render(body: Buffer, contentType: string, options: RenderOptions): Promise<RenderedImage> {
    if (!contentType.startsWith('image/') || (!options.width && !options.height)) {
      return { body, contentType, status: 200 };
    }

    try {
      const resized = await sharp(body)
        .rotate()
        .resize({ width: options.width, height: options.height, fit: 'inside', withoutEnlargement: true })
        .jpeg()
        .toBuffer();

      return { body: resized, contentType: 'image/jpeg', status: 200 };
    } catch (error) {
      logger.error(`Failed resizing image: ${String(error)}`);
      return { body: await readFile('assets/no-image_placeholder.png'), contentType: 'image/png', status: 500 };
    }
  }
}
