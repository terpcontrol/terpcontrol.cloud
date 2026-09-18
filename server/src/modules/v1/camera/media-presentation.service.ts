import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Turning a stored picture into what goes over the wire.
 *
 * The bytes in the bucket are never rewritten: a thumbnail and the width a free
 * camera's stills are served at are both decided here, on the way out. That is
 * what lets a camera that is extended serve its whole history at full size again.
 */

const MAX_DIMENSION = 4096;

export interface RenderSize {
  width?: number;
  height?: number;
}

/** A dimension a client asked for, or nothing at all - which is the stored picture whole. */
export const parseDimension = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  return Math.min(Math.floor(parsed), MAX_DIMENSION);
};

/** The narrower of what was asked for and what the tier allows; a cap is never widened by a request. */
export const narrowestOf = (asked: RenderSize, cap: number | undefined): RenderSize =>
  cap === undefined ? asked : { width: Math.min(asked.width ?? cap, cap), height: asked.height };

@Injectable()
export class MediaPresentationService {
  /** Resizes when there is anything to do, never enlarging. */
  public async resize(body: Buffer, size: RenderSize): Promise<Buffer> {
    if (!size.width && !size.height) return body;

    return sharp(body)
      .rotate()
      .resize({ ...size, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  }
}
