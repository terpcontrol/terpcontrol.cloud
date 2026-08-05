import { NextFunction, Request, Response } from 'express';
import { RequestWithUser } from '@/interfaces/auth.interface';
import { isUserDeviceMiddelware, isUserDeviceOrShareMiddelware } from '@/middlewares/auth.middleware';
import { imageService } from '@services/image.service';
import { verifyImageUrlToken } from '@utils/imageUrlToken';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// The size segment of a token image URL, e.g. "454x454.jpg". The extension is optional
// and only there so the URL looks like an image file to whoever fetches it.
function parseSizeSegment(value: string): { width?: number; height?: number } {
  const match = /^(\d+)x(\d+)(?:\.jpe?g)?$/i.exec(value ?? '');
  if (!match) {
    return {};
  }

  return { width: parseResizeDimension(match[1]), height: parseResizeDimension(match[2]) };
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
        // Share links without webcam access may still fetch diary photos (image_id),
        // but not the webcam stills/timelapses addressed by timestamp.
        if (req.share && !req.share.webcam && !req.query.image_id) {
          res.status(401).send();
          return;
        }

        const image = await imageService.getDeviceImage(
          req.params.device_id,
          String(req.query.format),
          Number(req.query.timestamp),
          String(req.query.duration || ''),
          String(req.query.image_id ?? ''),
        );

        if (image) {
          this.sendImage(req, res, image.data, image.format === 'mp4' ? 'video/mp4' : 'image/jpeg');
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

  // The same webcam still as getDeviceImage, addressed by a URL that carries no query
  // string and stays around 110 characters: /image/<device_id>/<token>/<w>x<h>.jpg.
  // A Garmin watch hands the URL to the phone before it is fetched, and the JWT image
  // token makes that URL far too long to survive the trip.
  public getDeviceImageByUrlToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!verifyImageUrlToken(req.params.device_id, req.params.token)) {
        res.status(401).send('Wrong or expired image token');
        return;
      }

      const size = parseSizeSegment(req.params.size);
      const image = await imageService.getDeviceImage(req.params.device_id, 'jpeg');

      if (image) {
        this.sendImage(req, res, image.data, 'image/jpeg', size);
      } else {
        this.sendImage(req, res, await readFile('assets/no-image_placeholder.png'), 'image/png', size);
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

  private sendImage(req: Request, res: Response, image: Buffer, contentType: string, size?: { width?: number; height?: number }) {
    const width = size ? size.width : parseResizeDimension(req.query.width);
    const height = size ? size.height : parseResizeDimension(req.query.height);

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
