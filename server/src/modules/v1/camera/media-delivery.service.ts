import { HttpStatus, Injectable } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import parseRange from 'range-parser';
import { logger } from '@utils/logger';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from './cameras.service';
import { EntitlementService } from './entitlement.service';
import { MediaPresentationService, RenderSize, narrowestOf } from './media-presentation.service';
import { MediaService } from './media.service';

/**
 * Handing the stored bytes to a client, whichever route was asked.
 *
 * Two routes serve the same picture: `/v1/media/{id}/content`, which a session
 * or a share link reaches, and the public page's own, which has no session at
 * all and decides by the grow's address instead. What comes back has to be the
 * same file, narrowed by the same tier and with the same byte ranges honoured,
 * so the decision about who may look stays with the route and everything after
 * it lives here.
 *
 * **Why the bytes are cached privately.** A picture never changes, so an hour in
 * the reader's own browser costs nothing and saves a round trip per thumbnail.
 * What it must not do is sit in a cache somebody else is served from: the same
 * route answers a session, a share link and a public diary, and a grower who
 * takes a diary down stops the origin answering at once. `private` is what keeps
 * that instant from becoming an hour.
 */
const CACHE_CONTROL = 'private, max-age=3600';

@Injectable()
export class MediaDeliveryService {
  constructor(
    private readonly media: MediaService,
    private readonly cameras: CamerasService,
    private readonly entitlement: EntitlementService,
    private readonly presentation: MediaPresentationService,
  ) {}

  /**
   * `redacted` is whether the reader is somebody outside the space - a link or
   * a public page. The owner's stored original may still carry where and on
   * what it was taken, and that is not part of what such a reader is shown, so
   * they get the picture re-encoded without it. Rewriting the bucket instead
   * would take the original from the owner and their export, and would only
   * cover the pictures somebody remembered to rewrite.
   */
  public async deliver(request: FastifyRequest, reply: FastifyReply, media: MediaDocument, asked: RenderSize, redacted: boolean): Promise<void> {
    const size = narrowestOf(asked, await this.servedWidth(media));

    // Rewriting a picture needs all of it in memory, and only a still is ever
    // rewritten - a film is neither resized nor marked - so the whole-buffer
    // path stays off the videos, which run to tens of megabytes.
    if (media.mime.startsWith('image/') && (size.width || size.height)) {
      const resized = await this.presentation.resize(await this.media.download(media.id), size);
      await reply.header('Content-type', media.mime).header('Cache-Control', CACHE_CONTROL).send(resized);
      return;
    }

    if (media.mime.startsWith('image/') && redacted) {
      const stripped = await this.presentation.withoutMetadata(await this.media.download(media.id));
      await reply.header('Content-type', media.mime).header('Cache-Control', CACHE_CONTROL).send(stripped);
      return;
    }

    await this.stream(request, reply, media);
  }

  /** Nothing but a still of a camera is ever narrowed, and only where an install enforces a tier. */
  private async servedWidth(media: MediaDocument): Promise<number | undefined> {
    if (media.kind !== 'still' || media.cameraId === null || !this.entitlement.enforced) return undefined;

    const camera = await this.cameras.byId(media.cameraId);
    return camera ? this.entitlement.servedStillWidth(camera) : undefined;
  }

  /**
   * The stored bytes, straight out of the bucket. A film runs to tens of
   * megabytes, so it is piped rather than buffered, and byte ranges are honoured
   * - a <video> element asks for them, and Safari will not start playing without
   * a 206.
   */
  private async stream(request: FastifyRequest, reply: FastifyReply, media: MediaDocument): Promise<void> {
    // -1 is "asked for bytes we do not have", -2 "asked in a way we cannot read".
    const header = request.headers.range;
    const ranges = header ? parseRange(media.bytes, header, { combine: true }) : undefined;

    void reply.header('Content-type', media.mime).header('Cache-Control', CACHE_CONTROL).header('Accept-Ranges', 'bytes');

    if (ranges === -1) {
      await reply.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).header('Content-Range', `bytes */${media.bytes}`).send();
      return;
    }

    // Several ranges at once would need a multipart body no client here asks for.
    const range = Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1 ? ranges[0] : undefined;

    if (range) {
      void reply
        .status(HttpStatus.PARTIAL_CONTENT)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${media.bytes}`)
        .header('Content-Length', range.end - range.start + 1);
    } else {
      void reply.header('Content-Length', media.bytes);
    }

    const stream = this.media.read(media.id, range);
    stream.on('error', error => {
      logger.error(`Failed streaming media ${media.id}: ${error}`);
      // The status line is long gone by the time a chunk fails, so cutting the
      // connection is all that is left to tell the client the body is short.
      reply.raw.destroy();
    });

    await reply.send(stream);
  }
}
