import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import type { MediaDocument } from '@database/schemas/v1/media.schema';
import type { CamerasService } from '@modules/v1/camera/cameras.service';
import type { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { MediaDeliveryService } from '@modules/v1/camera/media-delivery.service';
import { MediaPresentationService } from '@modules/v1/camera/media-presentation.service';
import type { MediaService } from '@modules/v1/camera/media.service';

/**
 * What a picture carries besides its pixels. Pictures uploaded before the store
 * re-encoded them still hold the phone's EXIF block - where it was taken, the
 * phone, the time - and a reader outside the space is not to be handed that.
 */

const aPhoneJpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 40, height: 20, channels: 3, background: '#3a6' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'samsung', Model: 'Galaxy S23' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 0/1 3/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();

/** A reply that remembers what was sent. */
const aReply = (): { reply: FastifyReply; sent: () => unknown } => {
  let body: unknown;
  const reply = {
    header: () => reply,
    status: () => reply,
    send: (value: unknown) => {
      body = value;
      return Promise.resolve(reply);
    },
    raw: { destroy: () => undefined },
  };

  return { reply: reply as unknown as FastifyReply, sent: () => body };
};

describe('handing a picture over', () => {
  let original: Buffer;
  let delivery: MediaDeliveryService;
  const photo = { id: 'p1', kind: 'photo', mime: 'image/jpeg', cameraId: null, bytes: 0 } as unknown as MediaDocument;

  beforeAll(async () => {
    original = await aPhoneJpeg();
    photo.bytes = original.length;
    const media = { download: () => Promise.resolve(original), read: () => Readable.from([original]) } as unknown as MediaService;
    delivery = new MediaDeliveryService(media, {} as CamerasService, { enforced: false } as EntitlementService, new MediaPresentationService());
  });

  it('keeps the metadata in the file it was given, so the check below means something', async () => {
    const meta = await sharp(original).metadata();
    expect(meta.exif).toBeDefined();
  });

  it('hands a reader outside the space the picture without any of it, turned the right way up', async () => {
    const { reply, sent } = aReply();
    await delivery.deliver({ headers: {} } as FastifyRequest, reply, photo, {}, true);

    const meta = await sharp(sent() as Buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });

  it('hands the owner the stored original untouched', async () => {
    const { reply, sent } = aReply();
    await delivery.deliver({ headers: {} } as FastifyRequest, reply, photo, {}, false);

    expect(sent()).toBeInstanceOf(Readable);
  });
});
