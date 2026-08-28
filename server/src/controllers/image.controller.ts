import { NextFunction, Request, Response } from 'express';
import { RequestWithUser } from '@/interfaces/auth.interface';
import { darfBildLesen, isUserDeviceMiddelware, isUserDeviceOrShareMiddelware } from '@/middlewares/auth.middleware';
import { imageService } from '@services/image.service';
import { ONLINE_TIMEOUT } from '@services/device.service';
import { Image } from '@fg2/shared-types';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// Requests for the current picture carry no timestamp, or one at "now" as a cache
// buster. Anything older asks for the past and is served without the notice.
const LATEST_IMAGE_TOLERANCE_MS = 60 * 1000;

// Drawn into the image, so the time zone is named: the reader cannot tell which
// one the server used otherwise.
function buildOfflineCaption(timestamp: number): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(timestamp);
  return `Offline since ${when}`;
}

function parseResizeDimension(value: unknown, max = 4096): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }

  return Math.min(normalized, max);
}

class ImageController {
  public getDeviceImage = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (await isUserDeviceOrShareMiddelware(req, res, req.params.device_id, 'image')) {
        // A still addressed by timestamp is a camera read whatever comes back,
        // so a link without the camera is refused before the query rather than
        // after it. What comes back by `image_id` is decided by the row.
        if (req.share && !req.share.webcam && !req.query.image_id) {
          res.status(403).send();
          return;
        }

        const image = await imageService.getDeviceImage(
          req.params.device_id,
          String(req.query.format),
          Number(req.query.timestamp),
          String(req.query.duration || ''),
          String(req.query.image_id ?? ''),
        );

        // The guard above authorised the *device* in the URL; a share is issued
        // for one half of one tent, and an `image_id` names a row rather than a
        // device. So the row is authorised too, against the tent it belongs to.
        if (image && req.share && !(await darfBildLesen(req, image))) {
          res.status(403).send();
          return;
        }

        if (image) {
          this.sendImage(req, res, await this.withOfflineOverlay(req, image), image.format === 'mp4' ? 'video/mp4' : 'image/jpeg');
        } else {
          if (req.query.format === 'mp4') {
            this.sendImage(req, res, await readFile('assets/no-image_placeholder.mp4'), 'video/mp4');
          } else {
            this.sendImage(req, res, await readFile('assets/no-image_placeholder.png'), 'image/png');
          }
        }
      } else {
        res.status(401).send();
      }
    } catch (error) {
      next(error);
    }
  };

  public uploadDeviceImage = async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserDeviceMiddelware(req, res, req.params.device_id, 'user'))) {
        return;
      }

      const files = req.files as Record<string, any> | undefined;
      const uploaded = files?.image;
      const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;

      if (!file?.data || !Buffer.isBuffer(file.data)) {
        res.status(400).json({ message: 'Image file is missing or invalid' });
        return;
      }

      const timestamp = Number(req.body?.timestamp);
      const image = await imageService.createDeviceImage(req.params.device_id, file.data, Number.isFinite(timestamp) ? timestamp : undefined);

      res.status(201).json({
        image_id: image.image_id,
        device_id: image.device_id,
        timestamp: image.timestamp,
        format: image.format,
      });
    } catch (error) {
      next(error);
    }
  };

  public testDeviceWebcam = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserDeviceMiddelware(req, res, req.params.device_id, 'user'))) {
        return;
      }

      const rtspStream = typeof req.body?.rtspStream === 'string' ? req.body.rtspStream.trim() : '';
      if (!rtspStream) {
        res.status(400).json({ message: 'rtspStream is missing or invalid' });
        return;
      }

      try {
        const image = await imageService.testRtspStream(req.params.device_id, {
          rtspStream,
          rtspStreamTransport: typeof req.body?.rtspStreamTransport === 'string' ? req.body.rtspStreamTransport : undefined,
          tunnelRtspStream: !!req.body?.tunnelRtspStream,
        });

        res.setHeader('Content-type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(image);
      } catch (e) {
        res.status(502).json({ message: String(e?.message ?? 'Failed to read an image from the webcam stream').slice(0, 2000) });
      }
    } catch (error) {
      next(error);
    }
  };

  public deleteImage = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const image = await imageService.getImageById(req.params.image_id);
      if (!image) {
        res.status(404).json({ status: 'not found' });
        return;
      }

      if (!(await isUserDeviceMiddelware(req, res, image.device_id, 'user'))) {
        return;
      }

      const deleted = await imageService.deleteImage(req.params.image_id);
      if (!deleted) {
        res.status(404).json({ status: 'not found' });
        return;
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };

  // The image URL is consumed by the webapp and by other services alike, so a
  // still that is too old for the device to count as online carries the notice
  // in the picture instead of leaving it to the client.
  private async withOfflineOverlay(req: RequestWithUser, image: Image): Promise<Buffer> {
    const requestedTimestamp = Number(req.query.timestamp);
    const wantsLatest = !(requestedTimestamp > 0) || requestedTimestamp >= Date.now() - LATEST_IMAGE_TOLERANCE_MS;

    if (image.format !== 'jpeg' || req.query.image_id || !wantsLatest || Date.now() - image.timestamp <= ONLINE_TIMEOUT) {
      return image.data;
    }

    return imageService.addOfflineOverlay(image.data, buildOfflineCaption(image.timestamp));
  }

  private sendImage(req: Request, res: Response, image: Buffer, contentType: string) {
    const width = parseResizeDimension(req.query.width);
    const height = parseResizeDimension(req.query.height);

    if (contentType.startsWith('image/') && (width || height)) {
      void sharp(image)
        .rotate()
        .resize({
          width,
          height,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg()
        .toBuffer()
        .then(resizedBuffer => {
          res.setHeader('Content-type', 'image/jpeg');
          res.setHeader('Cache-Control', 'max-age=3600');
          res.send(resizedBuffer);
        })
        .catch(async e => {
          console.log('Failed resizing image:', e);
          res.status(500).send(await readFile('assets/no-image_placeholder.png'));
        });
    } else {
      res.setHeader('Content-type', contentType);
      res.setHeader('Cache-Control', 'max-age=3600');
      res.send(image);
    }
  }
}

export default ImageController;
