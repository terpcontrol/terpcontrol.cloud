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

/**
 * The longest edge a picture somebody uploaded is kept at. A phone takes far
 * more than any screen shows, and a diary of a hundred photos at full sensor
 * size is a bucket nobody can back up.
 */
const STORED_MAX_DIMENSION = 2560;

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
  /**
   * What an upload is stored as: one JPEG, turned the way it was taken.
   *
   * A phone sends HEIC, PNG or a JPEG whose orientation lives in its EXIF, and
   * everything downstream - the thumbnail, the timelapse composer, the public
   * page - reads a picture rather than a format. Rotating here rather than on
   * the way out also means the stored bytes are the picture: nothing else has to
   * remember which way up it is.
   *
   * A file that is not a picture at all fails here, which is the boundary it
   * should fail at.
   */
  public asStoredJpeg(body: Buffer): Promise<Buffer> {
    return sharp(body)
      .rotate()
      .resize({ width: STORED_MAX_DIMENSION, height: STORED_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  }

  /**
   * The same picture with nothing written around it: no place it was taken, no
   * phone, no time. What an upload is stored as has none of that already; a
   * picture carried over from before that rule still has all of it. It is
   * turned the way its metadata said first, because the orientation goes too.
   */
  public withoutMetadata(body: Buffer): Promise<Buffer> {
    return sharp(body).rotate().jpeg({ quality: 90, force: false }).toBuffer();
  }

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
