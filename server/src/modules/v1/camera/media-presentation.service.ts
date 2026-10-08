import { applyDecorators, HttpStatus, Injectable } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import sharp from 'sharp';
import { z } from 'zod';

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

const dimension = z.coerce.number().int().positive().optional();

/**
 * The size a picture is asked for at. Refused when it is not a positive whole
 * number, as `limit` is, rather than quietly answered with the whole picture.
 */
export const pictureSizeQuery = z.object({
  width: dimension.describe(`A thumbnail rather than the whole picture, in pixels. Never enlarged, and never more than ${MAX_DIMENSION}.`),
  height: dimension.describe(`The same for the height. Never enlarged, and never more than ${MAX_DIMENSION}.`),
});

/** The size a picture was asked for at, never past the limit; a side not asked for is left to the picture. */
export const renderSizeOf = (query: z.infer<typeof pictureSizeQuery>): RenderSize => ({
  width: query.width && Math.min(query.width, MAX_DIMENSION),
  height: query.height && Math.min(query.height, MAX_DIMENSION),
});

/** What the store holds: stills and photos as they were taken, films as they were rendered. */
const PICTURE_BYTES = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'video/mp4': { schema: { type: 'string', format: 'binary' } },
};

/**
 * What a route that hands out stored bytes answers: the file, the range a
 * player asked for, or - for a range that starts past the end of the file - a
 * refusal like every other rather than an empty body.
 */
export const ApiPictureBytes = () =>
  applyDecorators(
    ApiResponse({ status: HttpStatus.OK, description: 'The file itself, in the type it was stored as.', content: PICTURE_BYTES }),
    ApiResponse({ status: HttpStatus.PARTIAL_CONTENT, description: 'The byte range a <video> element asked for.', content: PICTURE_BYTES }),
    ApiResponse({
      status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      description: 'The byte range asked for starts past the end of the file. `Content-Range` says how long it is.',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    }),
  );

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

  /** Never enlarges. */
  public resize(body: Buffer, size: RenderSize): Promise<Buffer> {
    return sharp(body)
      .rotate()
      .resize({ ...size, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  }
}
