import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import { authMiddleware } from '@/middlewares/auth.middleware';
import ImageController from '@controllers/image.controller';

class ImageRoute implements Routes {
  public path = '/image';
  public router = Router();
  public imageController = new ImageController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    /**
     * @openapi
     * /image/{device_id}:
     *   get:
     *     summary: Get a device image or timelapse
     *     description: Returns the binary image (jpeg) or timelapse (mp4) for a device. Accessible for owners and through a valid share link (`share` query parameter). Falls back to a placeholder asset when no image exists.
     *     tags: [Images]
     *     security:
     *       - bearerAuth: []
     *       - {}
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: format
     *         schema: { type: string, enum: [jpeg, mp4] }
     *       - in: query
     *         name: timestamp
     *         schema: { type: number }
     *         description: Pick the image closest to this Unix timestamp (seconds).
     *       - in: query
     *         name: duration
     *         schema: { type: string, enum: ['1d', '1w', '1m'] }
     *         description: Timelapse window for mp4 results.
     *       - in: query
     *         name: image_id
     *         schema: { type: string }
     *       - in: query
     *         name: width
     *         schema: { type: integer }
     *         description: Optional resize width (jpeg only).
     *       - in: query
     *         name: height
     *         schema: { type: integer }
     *         description: Optional resize height (jpeg only).
     *     responses:
     *       '200':
     *         description: Image or video binary
     *         content:
     *           image/jpeg:
     *             schema: { type: string, format: binary }
     *           image/png:
     *             schema: { type: string, format: binary }
     *           video/mp4:
     *             schema: { type: string, format: binary }
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.get(`${this.path}/:device_id`, this.imageController.getDeviceImage);

    /**
     * @openapi
     * /image/test/{device_id}:
     *   post:
     *     summary: Test a webcam stream URL by capturing a single image
     *     description: Downloads one frame from the given webcam stream URL on demand (without storing it) so the user can verify the URL before saving the cloud settings. Only accessible for device owners.
     *     tags: [Images]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [rtspStream]
     *             properties:
     *               rtspStream:
     *                 type: string
     *                 description: Webcam stream URL to test.
     *               rtspStreamTransport:
     *                 type: string
     *                 enum: [tcp, http, https]
     *               tunnelRtspStream:
     *                 type: boolean
     *     responses:
     *       '200':
     *         description: Captured image
     *         content:
     *           image/jpeg:
     *             schema: { type: string, format: binary }
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '502':
     *         description: Reading an image from the stream failed
     */
    this.router.post(`${this.path}/test/:device_id`, authMiddleware, this.imageController.testDeviceWebcam);

    /**
     * @openapi
     * /image/{device_id}:
     *   post:
     *     summary: Upload a manual image for a device
     *     tags: [Images]
     *     parameters:
     *       - in: path
     *         name: device_id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             required: [image]
     *             properties:
     *               image:
     *                 type: string
     *                 format: binary
     *               timestamp:
     *                 type: number
     *                 description: Optional Unix timestamp (seconds).
     *     responses:
     *       '201':
     *         description: Image stored
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Image'
     *       '400':
     *         $ref: '#/components/responses/BadRequest'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     */
    this.router.post(`${this.path}/:device_id`, authMiddleware, this.imageController.uploadDeviceImage);

    /**
     * @openapi
     * /image/{image_id}:
     *   delete:
     *     summary: Delete an image
     *     tags: [Images]
     *     parameters:
     *       - in: path
     *         name: image_id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       '200':
     *         description: Image deleted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StatusOk'
     *       '401':
     *         $ref: '#/components/responses/Unauthorized'
     *       '404':
     *         $ref: '#/components/responses/NotFound'
     */
    this.router.delete(`${this.path}/:image_id`, authMiddleware, this.imageController.deleteImage);
  }
}

export default ImageRoute;
